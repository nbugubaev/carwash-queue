import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { getSupabase } from '../supabase';
import { RefreshCw, Plus, X, CheckSquare, AlertTriangle } from 'lucide-react';

export default function OperatorPanel({ businessId }) {
  const supabase = getSupabase();
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offlineBoxes, setOfflineBoxes] = useState([]);

  const [washing, setWashing] = useState([]);
  const [confirming, setConfirming] = useState([]);
  const [waiting, setWaiting] = useState([]);
  const [missed, setMissed] = useState([]);

  const [nowTime, setNowTime] = useState(new Date());
  const [confirmComplete, setConfirmComplete] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [plateNumber, setPlateNumber] = useState('');

  // Пропускаем первый рендер при изменении offlineBoxes
  const isFirstOfflineRender = useRef(true);

  // ── Вызов следующих клиентов ─────────────────────────────────────────────

  const inviteNext = useCallback(async (currentWashing, currentConfirming, currentWaiting, currentBusiness, currentOffline) => {
    if (!supabase || !currentBusiness) return;
    try {
      const offline = currentOffline || [];
      const activeBoxes = currentBusiness.boxes_count - offline.length;
      const activeCount = currentWashing.length + currentConfirming.length;
      const freeSlots = Math.max(0, activeBoxes - activeCount);
      if (freeSlots <= 0 || currentWaiting.length === 0) return;

      const toInvite = currentWaiting.slice(0, freeSlots);
      const now = new Date().toISOString();
      for (const item of toInvite) {
        await supabase
          .from('queue')
          .update({ status: 'confirmed', invited_at: now })
          .eq('id', item.id);
      }
    } catch (err) {
      console.error('Error inviting next:', err);
    }
  }, [supabase]);

  // ── Авто-отмена истёкших confirmed ───────────────────────────────────────

  const checkExpiredConfirmed = useCallback(async (currentConfirming, currentWaiting, currentBusiness) => {
    if (!supabase || !currentBusiness || currentConfirming.length === 0) return;
    const timeout = currentBusiness.confirmation_timeout || 180;
    const now = new Date();
    const expired = currentConfirming.filter(item => {
      if (!item.invited_at) return false;
      return Math.floor((now - new Date(item.invited_at)) / 1000) >= timeout;
    });
    if (expired.length === 0) return;

    const cancelledAt = now.toISOString();
    for (const item of expired) {
      await supabase
        .from('queue')
        .update({ status: 'cancelled', cancelled_at: cancelledAt })
        .eq('id', item.id);
    }
    const remaining = currentConfirming.filter(i => !expired.find(e => e.id === i.id));
    await inviteNext([], remaining, currentWaiting, currentBusiness, currentBusiness.offline_boxes || []);
  }, [supabase, inviteNext]);

  // ── Загрузка данных ───────────────────────────────────────────────────────

  const fetchAll = useCallback(async (currentBusiness, autoInvite = false) => {
    if (!supabase || !businessId) return;
    try {
      const { data: active } = await supabase
        .from('queue')
        .select('*')
        .eq('business_id', businessId)
        .in('status', ['waiting', 'confirmed', 'in_box'])
        .order('joined_at', { ascending: true });

      const { data: cancelled } = await supabase
        .from('queue')
        .select('*')
        .eq('business_id', businessId)
        .eq('status', 'cancelled')
        .not('invited_at', 'is', null)
        .order('cancelled_at', { ascending: false })
        .limit(20);

      const all = active || [];
      const newWashing    = all.filter(i => i.status === 'in_box');
      const newConfirming = all.filter(i => i.status === 'confirmed');
      const newWaiting    = all.filter(i => i.status === 'waiting');
      const newMissed     = cancelled || [];

      setWashing(newWashing);
      setConfirming(newConfirming);
      setWaiting(newWaiting);
      setMissed(newMissed);

      if (autoInvite && currentBusiness) {
        await inviteNext(newWashing, newConfirming, newWaiting, currentBusiness, currentBusiness.offline_boxes || []);
      }
    } catch (err) {
      console.error('fetchAll error:', err);
    }
  }, [businessId, supabase, inviteNext]);

  useEffect(() => {
    if (!supabase || !businessId) return;

    const init = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', businessId)
          .single();
        if (error) throw error;
        setBusiness(data);
        setOfflineBoxes(data.offline_boxes || []);
        await fetchAll(data, true);
      } catch (err) {
        console.error('Error loading business:', err);
      } finally {
        setLoading(false);
      }
    };

    init();

    const qChannel = supabase
      .channel('operator-queue')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'queue',
        filter: `business_id=eq.${businessId}`
      }, () => fetchAll(null, false))
      .subscribe();

    const busChannel = supabase
      .channel('operator-business')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'businesses',
        filter: `id=eq.${businessId}`
      }, (payload) => {
        setBusiness(payload.new);
        setOfflineBoxes(payload.new.offline_boxes || []);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(qChannel);
      supabase.removeChannel(busChannel);
    };
  }, [businessId, supabase, fetchAll]);

  // ── При включении бокса — вызываем следующего из очереди ─────────────────

  useEffect(() => {
    // Пропускаем первый рендер — при загрузке уже вызывается inviteNext в init()
    if (isFirstOfflineRender.current) {
      isFirstOfflineRender.current = false;
      return;
    }
    if (!business || loading) return;
    inviteNext(washing, confirming, waiting, business, offlineBoxes);
  }, [offlineBoxes]);

  // Живые таймеры + проверка истёкших
  useEffect(() => {
    const timer = setInterval(() => setNowTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!business || confirming.length === 0) return;
    const checker = setInterval(() => {
      checkExpiredConfirmed(confirming, waiting, business);
    }, 5000);
    return () => clearInterval(checker);
  }, [confirming, waiting, business, checkExpiredConfirmed]);

  // ── Переключение боксов ───────────────────────────────────────────────────

  const handleToggleBox = async (boxNum) => {
    const updated = offlineBoxes.includes(boxNum)
      ? offlineBoxes.filter(n => n !== boxNum)
      : [...offlineBoxes, boxNum];

    setOfflineBoxes(updated);
    try {
      await supabase
        .from('businesses')
        .update({ offline_boxes: updated })
        .eq('id', businessId);
    } catch (err) {
      console.error('Error toggling box:', err);
      setOfflineBoxes(offlineBoxes);
    }
  };

  // ── Действия очереди ──────────────────────────────────────────────────────

  const handleStartWash = async (item) => {
    try {
      await supabase
        .from('queue')
        .update({ status: 'in_box', started_at: new Date().toISOString() })
        .eq('id', item.id);
    } catch (err) {
      console.error('Error starting wash:', err);
    }
  };

  const handleCompleteWash = async () => {
    if (!confirmComplete) return;
    try {
      await supabase
        .from('queue')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', confirmComplete.id);
      const updatedWashing = washing.filter(i => i.id !== confirmComplete.id);
      await inviteNext(updatedWashing, confirming, waiting, business, offlineBoxes);
      setConfirmComplete(null);
    } catch (err) {
      console.error('Error completing wash:', err);
    }
  };

  const handleKick = async (item) => {
    if (!confirm(`Исключить машину ${item.plate_number} из очереди?`)) return;
    try {
      await supabase
        .from('queue')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', item.id);
    } catch (err) {
      console.error('Error kicking:', err);
    }
  };

  const handleAddManual = async (e) => {
    e.preventDefault();
    if (!plateNumber.trim()) return;
    try {
      await supabase
        .from('queue')
        .insert([{
          business_id: businessId,
          plate_number: plateNumber.trim().toUpperCase(),
          status: 'waiting',
          presence_confirmed: false,
          created_by: 'operator',
        }]);
      setPlateNumber('');
      setShowAddModal(false);
    } catch (err) {
      alert('Ошибка: ' + err.message);
    }
  };

  // ── Вспомогательные ──────────────────────────────────────────────────────

  const formatElapsed = (startedAt) => {
    if (!startedAt) return '00:00';
    const diff = Math.max(0, nowTime - new Date(startedAt));
    const total = Math.floor(diff / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatCountdown = (invitedAt) => {
    if (!invitedAt || !business) return null;
    const timeout = business.confirmation_timeout || 180;
    const elapsed = Math.floor((nowTime - new Date(invitedAt)) / 1000);
    const remaining = Math.max(0, timeout - elapsed);
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── Рендер ───────────────────────────────────────────────────────────────

  if (!supabase) {
    return <div className="glass-panel" style={{ margin: '2rem', textAlign: 'center' }}>Supabase не настроен.</div>;
  }

  if (loading || !business) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <RefreshCw size={40} style={{ animation: 'spin 1.5s linear infinite' }} />
      </div>
    );
  }

  const allBoxesOffline = offlineBoxes.length >= business.boxes_count;
  const boxes = Array.from({ length: business.boxes_count }, (_, i) => {
    const num = i + 1;
    return { num, isOffline: offlineBoxes.includes(num) };
  });

  return (
    <>
      <div className="container animate-slide-up" style={{ paddingBottom: '5rem' }}>

        {/* Шапка */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2rem' }}>Панель оператора</h1>
            <p style={{ color: 'var(--text-secondary)' }}>{business.name} · Боксов: {business.boxes_count}</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={18} /> Добавить вручную
          </button>
        </div>

        {/* ── БОКСЫ ────────────────────────────────────────────────────────── */}
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            Боксы
            {allBoxesOffline && (
              <span style={{ fontSize: '0.8rem', background: 'rgba(239,68,68,0.15)', color: 'var(--color-danger)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '999px', padding: '0.2rem 0.75rem', fontWeight: 600 }}>
                Все отключены
              </span>
            )}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
            {boxes.map(box => {
              const isOn = !box.isOffline;
              return (
                <div key={box.num} className="glass-panel" style={{
                  padding: '1.25rem',
                  border: `1px solid ${isOn ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  background: isOn ? 'rgba(16,185,129,0.04)' : 'rgba(239,68,68,0.04)',
                  display: 'flex', flexDirection: 'column', gap: '0.75rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '1rem' }}>Бокс {box.num}</span>
                    <div
                      onClick={() => handleToggleBox(box.num)}
                      style={{
                        width: 44, height: 24, borderRadius: 12,
                        background: isOn ? 'var(--color-success)' : 'rgba(239,68,68,0.6)',
                        position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
                      }}
                    >
                      <div style={{
                        position: 'absolute', top: 3, left: isOn ? 23 : 3,
                        width: 18, height: 18, borderRadius: '50%', background: 'white',
                        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                      }} />
                    </div>
                  </div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: isOn ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {isOn ? '● Работает' : '● Не работает'}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── МОЮТСЯ ───────────────────────────────────────────────────────── */}
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' }} />
            Моются ({washing.length})
          </h2>
          {washing.length === 0 ? (
            <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', textAlign: 'center' }}>Боксы свободны</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {washing.map(item => (
                <div key={item.id} className="glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', border: '1px solid rgba(34,197,94,0.3)', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.25rem' }}>{item.plate_number}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', color: 'var(--color-success)', fontWeight: 700 }}>{formatElapsed(item.started_at)}</span>
                  </div>
                  <button className="btn btn-success" style={{ padding: '0.5rem 1.25rem' }} onClick={() => setConfirmComplete(item)}>
                    Мойка завершена
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── ОЖИДАЮТ ПОДТВЕРЖДЕНИЯ ────────────────────────────────────────── */}
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-warning)', display: 'inline-block' }} />
            Ожидают подтверждения ({confirming.length})
          </h2>
          {confirming.length === 0 ? (
            <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', textAlign: 'center' }}>Нет вызванных клиентов</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {confirming.map(item => {
                const countdown = formatCountdown(item.invited_at);
                return (
                  <div key={item.id} className="glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', border: '1px solid rgba(245,158,11,0.3)', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.25rem' }}>{item.plate_number}</span>
                      {item.presence_confirmed ? (
                        <span style={{ fontSize: '0.9rem', color: 'var(--color-success)', fontWeight: 600 }}>✓ Едет</span>
                      ) : countdown ? (
                        <span style={{ fontFamily: 'monospace', fontSize: '1rem', color: 'var(--color-warning)', fontWeight: 600 }}>осталось {countdown}</span>
                      ) : null}
                    </div>
                    <button className="btn btn-primary" style={{ padding: '0.5rem 1.25rem' }} onClick={() => handleStartWash(item)}>
                      Начать мойку
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── ОЧЕРЕДЬ ──────────────────────────────────────────────────────── */}
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-color)', display: 'inline-block' }} />
            Очередь ({waiting.length})
          </h2>
          {waiting.length === 0 ? (
            <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', textAlign: 'center' }}>Очередь пуста</div>
          ) : (
            <div className="table-container">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Гос. номер</th>
                    <th>Ждёт с</th>
                    <th>Добавил</th>
                    <th>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.map((item, idx) => (
                    <tr key={item.id}>
                      <td style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{idx + 1}</td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.1rem' }}>{item.plate_number}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{new Date(item.joined_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                      <td><span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{item.created_by === 'operator' ? '👤 Оператор' : '📱 Клиент'}</span></td>
                      <td>
                        <button className="btn btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem', color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.2)' }} onClick={() => handleKick(item)}>
                          Исключить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── НЕ ОТВЕТИЛИ ──────────────────────────────────────────────────── */}
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertTriangle size={18} /> Не ответили ({missed.length})
          </h2>
          {missed.length === 0 ? (
            <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', textAlign: 'center' }}>Нет пропущенных вызовов</div>
          ) : (
            <div className="table-container">
              <table className="custom-table">
                <thead>
                  <tr>
                    <th>Гос. номер</th>
                    <th>Был вызван в</th>
                    <th>Отменён в</th>
                    <th>Действие</th>
                  </tr>
                </thead>
                <tbody>
                  {missed.map(item => (
                    <tr key={item.id}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.1rem' }}>{item.plate_number}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{item.invited_at ? new Date(item.invited_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{item.cancelled_at ? new Date(item.cancelled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td>
                        <button className="btn btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }} onClick={() => handleStartWash(item)}>
                          Начать мойку
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>

      {/* ── МОДАЛКА: ЗАВЕРШЕНИЕ МОЙКИ ── Portal ── */}
      {confirmComplete && ReactDOM.createPortal(
        <div className="modal-overlay">
          <div className="modal-content" style={{ textAlign: 'center' }}>
            <div style={{ color: 'var(--color-success)', marginBottom: '1rem' }}>
              <CheckSquare size={48} style={{ margin: '0 auto' }} />
            </div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>Завершить мойку?</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.4 }}>
              Автомобиль с гос. номером:<br />
              <strong style={{ fontSize: '1.35rem', fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                {confirmComplete.plate_number}
              </strong>
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn btn-success" style={{ flex: 1 }} onClick={handleCompleteWash}>ДА</button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmComplete(null)}>ОТМЕНА</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── МОДАЛКА: РУЧНОЕ ДОБАВЛЕНИЕ ── Portal ── */}
      {showAddModal && ReactDOM.createPortal(
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem' }}>Добавить клиента вручную</h3>
              <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddManual} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Гос. номер *</label>
                <input type="text" required placeholder="А777АА177" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} style={{ textTransform: 'uppercase' }} />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Добавить в очередь</button>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAddModal(false)}>Отмена</button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
