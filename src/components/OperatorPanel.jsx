import React, { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '../supabase';
import { RefreshCw, Plus, X, CheckSquare, AlertTriangle } from 'lucide-react';

export default function OperatorPanel({ businessId }) {
  const supabase = getSupabase();
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);

  // Очередь — все активные записи
  const [washing, setWashing] = useState([]);       // in_box
  const [confirming, setConfirming] = useState([]); // confirmed (ожидают подтверждения)
  const [waiting, setWaiting] = useState([]);        // waiting (в очереди)
  const [missed, setMissed] = useState([]);          // cancelled по таймеру (есть invited_at)

  // Таймеры
  const [nowTime, setNowTime] = useState(new Date());

  // Модалка завершения мойки
  const [confirmComplete, setConfirmComplete] = useState(null);

  // Модалка ручного добавления
  const [showAddModal, setShowAddModal] = useState(false);
  const [plateNumber, setPlateNumber] = useState('');

  // ── Загрузка данных ───────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    if (!supabase || !businessId) return;
    try {
      // Активные
      const { data: active } = await supabase
        .from('queue')
        .select('*')
        .eq('business_id', businessId)
        .in('status', ['waiting', 'confirmed', 'in_box'])
        .order('joined_at', { ascending: true });

      // Отменённые по таймеру (есть invited_at — значит были вызваны)
      const { data: cancelled } = await supabase
        .from('queue')
        .select('*')
        .eq('business_id', businessId)
        .eq('status', 'cancelled')
        .not('invited_at', 'is', null)
        .order('cancelled_at', { ascending: false })
        .limit(20);

      const all = active || [];
      setWashing(all.filter(i => i.status === 'in_box'));
      setConfirming(all.filter(i => i.status === 'confirmed'));
      setWaiting(all.filter(i => i.status === 'waiting'));
      setMissed(cancelled || []);
    } catch (err) {
      console.error('fetchAll error:', err);
    }
  }, [businessId, supabase]);

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
      } catch (err) {
        console.error('Error loading business:', err);
      } finally {
        setLoading(false);
      }
    };

    init();
    fetchAll();

    const qChannel = supabase
      .channel('operator-queue')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'queue',
        filter: `business_id=eq.${businessId}`
      }, () => fetchAll())
      .subscribe();

    const busChannel = supabase
      .channel('operator-business')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'businesses',
        filter: `id=eq.${businessId}`
      }, (payload) => setBusiness(payload.new))
      .subscribe();

    return () => {
      supabase.removeChannel(qChannel);
      supabase.removeChannel(busChannel);
    };
  }, [businessId, supabase, fetchAll]);

  // Живые таймеры
  useEffect(() => {
    const timer = setInterval(() => setNowTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // ── Действия ─────────────────────────────────────────────────────────────

  // Оператор запускает мойку вручную (confirmed или missed → in_box)
  const handleStartWash = async (item) => {
    try {
      await supabase
        .from('queue')
        .update({
          status: 'in_box',
          started_at: new Date().toISOString(),
        })
        .eq('id', item.id);
    } catch (err) {
      console.error('Error starting wash:', err);
    }
  };

  // Завершение мойки
  const handleCompleteWash = async () => {
    if (!confirmComplete) return;
    try {
      await supabase
        .from('queue')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', confirmComplete.id);

      // Вызываем следующего: первый confirmed или первый waiting
      await inviteNext();
      setConfirmComplete(null);
    } catch (err) {
      console.error('Error completing wash:', err);
    }
  };

  // Вызов следующего клиента (ставим статус confirmed + invited_at)
  const inviteNext = async () => {
    try {
      // Сколько боксов займут уже подтверждённые + моющиеся после завершения текущего
      const activeCount = washing.length - 1 + confirming.length; // -1 потому что один только что завершён
      const freeSlots = Math.max(0, (business?.boxes_count || 1) - activeCount);

      if (freeSlots <= 0) return;

      // Берём первых N из waiting
      const toInvite = waiting.slice(0, freeSlots);
      if (toInvite.length === 0) return;

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
  };

  // Исключить из очереди
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

  // Ручное добавление
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

  const formatCountdownFromInvited = (invitedAt) => {
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

  return (
    <div className="container animate-slide-up" style={{ paddingBottom: '5rem' }}>

      {/* Шапка */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem' }}>Панель оператора</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            {business.name} · Боксов: {business.boxes_count}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus size={18} /> Добавить вручную
        </button>
      </div>

      {/* ── ЗОНА 1: МОЮТСЯ ─────────────────────────────────────────────────── */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' }} />
          Моются ({washing.length})
        </h2>

        {washing.length === 0 ? (
          <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Боксы свободны
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {washing.map(item => (
              <div key={item.id} className="glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', border: '1px solid rgba(34,197,94,0.3)', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.25rem' }}>
                    {item.plate_number}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', color: 'var(--color-success)', fontWeight: 700 }}>
                    {formatElapsed(item.started_at)}
                  </span>
                </div>
                <button
                  className="btn btn-success"
                  style={{ padding: '0.5rem 1.25rem' }}
                  onClick={() => setConfirmComplete(item)}
                >
                  Мойка завершена
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── ЗОНА 2: ОЖИДАЮТ ПОДТВЕРЖДЕНИЯ ──────────────────────────────────── */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-warning)', display: 'inline-block' }} />
          Ожидают подтверждения ({confirming.length})
        </h2>

        {confirming.length === 0 ? (
          <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Нет вызванных клиентов
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {confirming.map(item => {
              const countdown = formatCountdownFromInvited(item.invited_at);
              return (
                <div key={item.id} className="glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', border: '1px solid rgba(245,158,11,0.3)', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.25rem' }}>
                      {item.plate_number}
                    </span>
                    {countdown && (
                      <span style={{ fontFamily: 'monospace', fontSize: '1rem', color: 'var(--color-warning)', fontWeight: 600 }}>
                        осталось {countdown}
                      </span>
                    )}
                  </div>
                  <button
                    className="btn btn-primary"
                    style={{ padding: '0.5rem 1.25rem' }}
                    onClick={() => handleStartWash(item)}
                  >
                    Начать мойку
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── ЗОНА 3: ОЧЕРЕДЬ ────────────────────────────────────────────────── */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-color)', display: 'inline-block' }} />
          Очередь ({waiting.length})
        </h2>

        {waiting.length === 0 && missed.length === 0 ? (
          <div className="glass-panel" style={{ padding: '1.25rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Очередь пуста
          </div>
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
                    <td>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {item.created_by === 'operator' ? '👤 Оператор' : '📱 Клиент'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem', color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.2)' }}
                        onClick={() => handleKick(item)}
                      >
                        Исключить
                      </button>
                    </td>
                  </tr>
                ))}

                {/* Не ответили — отделены визуально */}
                {missed.length > 0 && (
                  <>
                    <tr>
                      <td colSpan={5} style={{ padding: '0.5rem 1rem', background: 'rgba(239,68,68,0.05)', borderTop: '1px solid rgba(239,68,68,0.2)' }}>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--color-danger)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <AlertTriangle size={14} /> Не ответили на вызов
                        </span>
                      </td>
                    </tr>
                    {missed.map(item => (
                      <tr key={item.id} style={{ opacity: 0.85 }}>
                        <td style={{ color: 'var(--color-danger)' }}>⚠️</td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '1.1rem' }}>{item.plate_number}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{new Date(item.joined_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                        <td>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {item.created_by === 'operator' ? '👤 Оператор' : '📱 Клиент'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-primary"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.8125rem' }}
                            onClick={() => handleStartWash(item)}
                          >
                            Начать мойку
                          </button>
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── МОДАЛКА: ЗАВЕРШЕНИЕ МОЙКИ ────────────────────────────────────────── */}
      {confirmComplete && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
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
        </div>
      )}

      {/* ── МОДАЛКА: РУЧНОЕ ДОБАВЛЕНИЕ ───────────────────────────────────────── */}
      {showAddModal && (
        <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem' }}>Добавить клиента вручную</h3>
              <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddManual} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Гос. номер *
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
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Добавить в очередь</button>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAddModal(false)}>Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
