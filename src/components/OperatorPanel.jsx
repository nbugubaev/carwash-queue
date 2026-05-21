import React, { useState, useEffect } from 'react';
import { getSupabase } from '../supabase';
import { 
  CheckSquare, AlertCircle, Plus, Users, Grid, 
  ToggleLeft, ToggleRight, Play, Check, X, RefreshCw 
} from 'lucide-react';

export default function OperatorPanel({ businessId }) {
  const supabase = getSupabase();
  const [business, setBusiness] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  // Box toggles
  const [offlineBoxes, setOfflineBoxes] = useState([]);

  // Manual Client Dialog
  const [showAddModal, setShowAddModal] = useState(false);
  const [plateNumber, setPlateNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  // Wash Completion Confirmation Modal
  const [confirmComplete, setConfirmComplete] = useState(null); // stores queue item to complete

  // Live Timer State
  const [nowTime, setNowTime] = useState(new Date());

  // Load business & active queue
  useEffect(() => {
    if (!supabase || !businessId) return;

    const init = async () => {
      setLoading(true);
      try {
        // Load business data
        const { data: busData, error: busErr } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', businessId)
          .single();

        if (busErr) throw busErr;
        setBusiness(busData);
        setOfflineBoxes(busData.offline_boxes || []);

        // Load active queue (waiting and in_box)
        const { data: queueData, error: qErr } = await supabase
          .from('queue')
          .select('*')
          .eq('business_id', businessId)
          .in('status', ['waiting', 'in_box'])
          .order('joined_at', { ascending: true });

        if (qErr) throw qErr;
        setQueue(queueData || []);
      } catch (err) {
        console.error('Initialization error:', err);
      } finally {
        setLoading(false);
      }
    };

    init();

    // Subscribe to realtime changes in the queue table for this business
    const qChannel = supabase
      .channel('operator-queue-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue',
          filter: `business_id=eq.${businessId}`
        },
        async () => {
          // Re-fetch queue on any database update to ensure consistency
          const { data } = await supabase
            .from('queue')
            .select('*')
            .eq('business_id', businessId)
            .in('status', ['waiting', 'in_box'])
            .order('joined_at', { ascending: true });
          
          if (data) {
            setQueue(data);
          }
        }
      )
      .subscribe();

    // Subscribe to business configuration changes
    const busChannel = supabase
      .channel('operator-business-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'businesses',
          filter: `id=eq.${businessId}`
        },
        (payload) => {
          setBusiness(payload.new);
          setOfflineBoxes(payload.new.offline_boxes || []);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(qChannel);
      supabase.removeChannel(busChannel);
    };
  }, [businessId, supabase]);

  // Live timers interval
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);



  // AUTOMATIC QUEUE ASSIGNMENT LOGIC
  // This runs in the Operator Panel background whenever queue or offlineBoxes change
  useEffect(() => {
    if (!business || queue.length === 0 || loading) return;
    
    // Find boxes that are busy
    const busyBoxes = queue
      .filter(item => item.status === 'in_box' && item.box_number)
      .map(item => item.box_number);

    // Find first available box (not offline, not busy)
    let freeBox = null;
    for (let i = 1; i <= business.boxes_count; i++) {
      if (!offlineBoxes.includes(i) && !busyBoxes.includes(i)) {
        freeBox = i;
        break; // found the first free box
      }
    }

    if (freeBox !== null) {
      // Find the first client who is 'waiting' AND 'presence_confirmed' = true
      const nextClient = queue.find(
        item => item.status === 'waiting' && item.presence_confirmed === true
      );

      if (nextClient) {
        // Automatically assign this client to the free box
        assignClientToBox(nextClient.id, freeBox);
      }
    }
  }, [queue, offlineBoxes, business, loading]);

  const assignClientToBox = async (clientId, boxNumber) => {
    try {
      const now = new Date().toISOString();
      await supabase
        .from('queue')
        .update({
          status: 'in_box',
          box_number: boxNumber,
          started_at: now
        })
        .eq('id', clientId);
      
      // The realtime subscription will trigger reload of queue
    } catch (err) {
      console.error('Error assigning client to box:', err);
    }
  };

  const handleToggleBox = async (boxNum) => {
    const updatedOffline = offlineBoxes.includes(boxNum)
      ? offlineBoxes.filter(n => n !== boxNum)
      : [...offlineBoxes, boxNum];
    
    setOfflineBoxes(updatedOffline);

    try {
      await supabase
        .from('businesses')
        .update({ offline_boxes: updatedOffline })
        .eq('id', businessId);
    } catch (err) {
      console.error('Error toggling box:', err);
    }
  };

  const handleAddManualClient = async (e) => {
    e.preventDefault();
    if (!plateNumber.trim()) return;

    try {
      const { error } = await supabase
        .from('queue')
        .insert([{
          business_id: businessId,
          plate_number: plateNumber.trim().toUpperCase(),
          phone_number: phoneNumber.trim() || null,
          status: 'waiting',
          presence_confirmed: true, // Manual checkin = physically present
          created_by: 'operator'
        }]);

      if (error) throw error;
      setPlateNumber('');
      setPhoneNumber('');
      setShowAddModal(false);
    } catch (err) {
      alert('Ошибка при добавлении: ' + err.message);
    }
  };

  const handleCompleteWash = async () => {
    if (!confirmComplete) return;

    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('queue')
        .update({
          status: 'completed',
          completed_at: now
        })
        .eq('id', confirmComplete.id);

      if (error) throw error;
      setConfirmComplete(null);
    } catch (err) {
      alert('Ошибка при завершении мойки: ' + err.message);
    }
  };

  // Helper: Format elapsed time (started_at to now)
  const formatElapsed = (startedAtStr) => {
    if (!startedAtStr) return '00:00';
    const start = new Date(startedAtStr);
    const diff = Math.max(0, nowTime - start);
    const totalSecs = Math.floor(diff / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!supabase) {
    return <div className="glass-panel" style={{ margin: '2rem', textAlign: 'center' }}>Подключение Supabase не настроено.</div>;
  }

  if (loading || !business) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <RefreshCw className="pulse-primary" size={40} style={{ animation: 'spin 1.5s linear infinite' }} />
      </div>
    );
  }

  // Active boxes status mapper
  const boxes = [];
  for (let i = 1; i <= business.boxes_count; i++) {
    const isOffline = offlineBoxes.includes(i);
    const occupyingClient = queue.find(item => item.status === 'in_box' && item.box_number === i);
    
    boxes.push({
      number: i,
      isOffline,
      client: occupyingClient || null
    });
  }

  const workingBoxesCount = business.boxes_count - offlineBoxes.length;

  return (
    <div className="container animate-slide-up" style={{ paddingBottom: '5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Панель оператора
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Управление боксами для автомойки <strong>{business.name}</strong> • Работает {workingBoxesCount} из {business.boxes_count} боксов
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus size={18} /> Добавить вручную
        </button>
      </div>

      {/* BLOCK A: BOXES GRID */}
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Grid size={22} style={{ color: 'var(--accent-color)' }} /> Состояние боксов
      </h2>

      <div className="grid-cols-4" style={{ marginBottom: '3rem' }}>
        {boxes.map((box) => (
          <div 
            key={box.number} 
            className={`glass-panel box-card ${
              box.isOffline ? 'offline' : box.client ? 'active-busy' : 'active-free'
            }`}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '1.35rem' }}>Бокс №{box.number}</h3>
                <button 
                  onClick={() => handleToggleBox(box.number)} 
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: box.isOffline ? 'var(--text-muted)' : 'var(--accent-color)'
                  }}
                  title={box.isOffline ? "Включить бокс" : "Отключить бокс"}
                >
                  {box.isOffline ? <ToggleLeft size={28} /> : <ToggleRight size={28} />}
                </button>
              </div>

              {box.isOffline ? (
                <div style={{ marginTop: '2rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                  🛑 ОТКЛЮЧЕН
                </div>
              ) : box.client ? (
                <div style={{ marginTop: '1.25rem' }}>
                  <span className="badge badge-info">Мойка в процессе</span>
                  <div style={{ marginTop: '0.75rem', fontSize: '1.25rem', fontWeight: 'bold', fontFamily: 'monospace' }}>
                    {box.client.plate_number}
                  </div>
                  <div className="box-timer">
                    {formatElapsed(box.client.started_at)}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: '2rem', color: 'var(--color-success)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-success)', display: 'inline-block' }}></span>
                  СВОБОДЕН
                </div>
              )}
            </div>

            {!box.isOffline && box.client && (
              <button 
                className="btn btn-success btn-block" 
                style={{ marginTop: '1rem', fontWeight: 'bold', letterSpacing: '0.02em', fontSize: '1.1rem', padding: '1rem 0' }}
                onClick={() => setConfirmComplete(box.client)}
              >
                Мойка завершена
              </button>
            )}
          </div>
        ))}
      </div>

      {/* BLOCK B: QUEUE LIST */}
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Users size={22} style={{ color: 'var(--accent-color)' }} /> Активная очередь ({queue.filter(c => c.status === 'waiting').length} машин ожидает)
      </h2>

      {queue.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
          Очередь пуста. Клиенты появятся здесь после регистрации или ручного добавления.
        </div>
      ) : (
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Гос. Номер</th>
                <th>Телефон</th>
                <th>Время записи</th>
                <th>Статус</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => (
                <tr key={item.id}>
                  <td style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '1.1rem' }}>{item.plate_number}</td>
                  <td>{item.phone_number || '—'}</td>
                  <td>{new Date(item.joined_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>
                    {item.status === 'in_box' ? (
                      <span className="badge badge-info">В боксе №{item.box_number}</span>
                    ) : item.presence_confirmed ? (
                      <span className="badge badge-success">Готов (Я на месте)</span>
                    ) : (
                      <span className="badge badge-warning">Ожидает подтверждения</span>
                    )}
                  </td>
                  <td>
                    {/* Operators cannot change order, but we can add a simple Cancel / Kick if they left */}
                    <button 
                      onClick={async () => {
                        if (confirm(`Удалить машину ${item.plate_number} из очереди?`)) {
                          await supabase
                            .from('queue')
                            .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
                            .eq('id', item.id);
                        }
                      }}
                      className="btn btn-secondary" 
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem', color: 'var(--color-danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                    >
                      Исключить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CONFIRM COMPLETE MODAL */}
      {confirmComplete && (
        <div className="modal-overlay">
          <div className="modal-content text-center" style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--color-success)', marginBottom: '1rem' }}>
              <CheckSquare size={48} style={{ margin: '0 auto' }} />
            </div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>Завершить мойку?</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: '1.4' }}>
              Подтвердите завершение обслуживания автомобиля с гос. номером: <br />
              <strong style={{ fontSize: '1.25rem', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                {confirmComplete.plate_number}
              </strong>
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn btn-success" style={{ flex: 1 }} onClick={handleCompleteWash}>
                ДА
              </button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmComplete(null)}>
                ОТМЕНА
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD MANUAL CLIENT MODAL */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem' }}>Добавить клиента вручную</h3>
              <button 
                onClick={() => setShowAddModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleAddManualClient} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Гос. Номер *
                </label>
                <input
                  type="text"
                  required
                  placeholder="А777АА177"
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value)}
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Номер телефона (опционально)
                </label>
                <input
                  type="tel"
                  placeholder="+79998887766"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  Добавить в очередь
                </button>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ flex: 1 }} 
                  onClick={() => setShowAddModal(false)}
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
