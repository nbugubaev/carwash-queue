import React, { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '../supabase';
import { Car, Clock, CheckCircle, XCircle, RefreshCw, LogOut, ArrowRight, MapPin, AlertTriangle, WrenchIcon } from 'lucide-react';

export default function ClientPanel({ businessId }) {
  const supabase = getSupabase();
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);

  const [myTicket, setMyTicket] = useState(null);
  const [myQueueId, setMyQueueId] = useState(() => localStorage.getItem(`client_queue_id_${businessId}`));
  const [queueAheadCount, setQueueAheadCount] = useState(0);

  const [plateNumber, setPlateNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [showCallAlert, setShowCallAlert] = useState(false);
  const [callCountdown, setCallCountdown] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // ── Загрузка бизнеса ─────────────────────────────────────────────────────

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

    const busChannel = supabase
      .channel('client-business')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'businesses',
        filter: `id=eq.${businessId}`
      }, (payload) => setBusiness(payload.new))
      .subscribe();

    return () => supabase.removeChannel(busChannel);
  }, [businessId, supabase]);

  // ── Восстановление тикета из localStorage ────────────────────────────────

  useEffect(() => {
    if (!supabase || !myQueueId) return;
    const restore = async () => {
      try {
        const { data, error } = await supabase
          .from('queue')
          .select('*')
          .eq('id', myQueueId)
          .single();
        if (error || !data) {
          localStorage.removeItem(`client_queue_id_${businessId}`);
          setMyQueueId(null);
          return;
        }
        setMyTicket(data);
      } catch (err) {
        console.error('Error restoring ticket:', err);
      }
    };
    restore();
  }, [myQueueId, businessId, supabase]);

  // ── Realtime подписка на тикет ───────────────────────────────────────────

  useEffect(() => {
    if (!supabase || !myTicket?.id) return;
    const channel = supabase
      .channel(`client-ticket-${myTicket.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'queue',
        filter: `id=eq.${myTicket.id}`
      }, (payload) => setMyTicket(payload.new))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [myTicket?.id, supabase]);

  // ── Подсчёт машин впереди ────────────────────────────────────────────────

  const refreshAheadCount = useCallback(async () => {
    if (!myTicket || myTicket.status !== 'waiting') return;
    try {
      const { count } = await supabase
        .from('queue')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('status', 'waiting')
        .lt('joined_at', myTicket.joined_at);
      setQueueAheadCount(count || 0);
    } catch (err) {
      console.error('Error counting ahead:', err);
    }
  }, [myTicket, businessId, supabase]);

  useEffect(() => { refreshAheadCount(); }, [refreshAheadCount]);

  useEffect(() => {
    if (!myTicket || myTicket.status !== 'waiting') return;
    const interval = setInterval(refreshAheadCount, 10000);
    return () => clearInterval(interval);
  }, [myTicket, refreshAheadCount]);

  // ── Алерт вызова + таймер ────────────────────────────────────────────────

  useEffect(() => {
    if (!myTicket || !business) return;
    if (myTicket.status === 'confirmed') {
      setShowCallAlert(true);
      setTimedOut(false);
      const timeout = business.confirmation_timeout || 180;
      const invitedAt = myTicket.invited_at ? new Date(myTicket.invited_at) : new Date();
      const elapsed = Math.floor((Date.now() - invitedAt.getTime()) / 1000);
      setCallCountdown(Math.max(0, timeout - elapsed));
    } else {
      setShowCallAlert(false);
    }
  }, [myTicket?.status, business]);

  useEffect(() => {
    if (!showCallAlert) return;
    if (callCountdown <= 0) {
      handleTimeoutCancel();
      return;
    }
    const timer = setInterval(() => setCallCountdown(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [showCallAlert, callCountdown]);

  // ── Действия ─────────────────────────────────────────────────────────────

  const handleTimeoutCancel = async () => {
    if (!myTicket) return;
    try {
      await supabase
        .from('queue')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', myTicket.id);
      setShowCallAlert(false);
      setTimedOut(true);
      setMyTicket(prev => ({ ...prev, status: 'cancelled' }));
    } catch (err) {
      console.error('Error on timeout cancel:', err);
    }
  };

  const handleJoinQueue = async (e) => {
    e.preventDefault();
    if (!plateNumber.trim() || submitting) return;
    setSubmitting(true);
    try {
      const plate = plateNumber.trim().toUpperCase();

      const { data: existing } = await supabase
        .from('queue')
        .select('*')
        .eq('business_id', businessId)
        .eq('plate_number', plate)
        .in('status', ['waiting', 'confirmed', 'in_box'])
        .limit(1);

      if (existing && existing.length > 0) {
        localStorage.setItem(`client_queue_id_${businessId}`, existing[0].id);
        setMyQueueId(existing[0].id);
        setMyTicket(existing[0]);
        setSubmitting(false);
        return;
      }

      const { data, error } = await supabase
        .from('queue')
        .insert([{
          business_id: businessId,
          plate_number: plate,
          status: 'waiting',
          presence_confirmed: false,
          created_by: 'client'
        }])
        .select();

      if (error) throw error;
      const ticketId = data[0].id;
      localStorage.setItem(`client_queue_id_${businessId}`, ticketId);
      setMyQueueId(ticketId);
      setMyTicket(data[0]);
      setTimedOut(false);
    } catch (err) {
      alert('Ошибка при записи: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmArrival = async () => {
    if (!myTicket) return;
    try {
      const { data, error } = await supabase
        .from('queue')
        .update({ presence_confirmed: true })
        .eq('id', myTicket.id)
        .select();
      if (error) throw error;
      setMyTicket(data[0]);
      setShowCallAlert(false);
    } catch (err) {
      console.error('Error confirming arrival:', err);
    }
  };

  const handleCancelQueue = async () => {
    if (!myTicket) return;
    try {
      await supabase
        .from('queue')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', myTicket.id);
      localStorage.removeItem(`client_queue_id_${businessId}`);
      setMyQueueId(null);
      setMyTicket(prev => ({ ...prev, status: 'cancelled' }));
      setShowCancelConfirm(false);
      setShowCallAlert(false);
    } catch (err) {
      console.error('Error cancelling:', err);
    }
  };

  const handleRegisterNew = () => {
    localStorage.removeItem(`client_queue_id_${businessId}`);
    setMyQueueId(null);
    setMyTicket(null);
    setPlateNumber('');
    setShowCallAlert(false);
    setTimedOut(false);
    setQueueAheadCount(0);
  };

  // ── Вспомогательные ──────────────────────────────────────────────────────

  const formatCountdown = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const estimatedWait = () => {
    if (!business) return 0;
    const activeBoxes = Math.max(1, business.boxes_count - (business.offline_boxes?.length || 0));
    return Math.max(1, Math.round((queueAheadCount + 1) / activeBoxes) * (business.base_wash_time || 30));
  };

  const allBoxesOffline = business
    ? (business.offline_boxes?.length || 0) >= business.boxes_count
    : false;

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

  // ── Экран: Мойка не работает ──────────────────────────────────────────────
  if (allBoxesOffline && !myTicket) {
    return (
      <div className="mobile-view animate-slide-up" style={{ textAlign: 'center', marginTop: '4rem' }}>
        <div className="glass-panel" style={{ padding: '3rem 2rem', border: '1px solid rgba(245,158,11,0.3)' }}>
          <div style={{ color: 'var(--color-warning)', marginBottom: '1.5rem' }}>
            <WrenchIcon size={64} style={{ margin: '0 auto' }} />
          </div>
          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>Мойка временно не работает</h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '1rem' }}>
            К сожалению, все боксы сейчас находятся на техническом обслуживании.<br /><br />
            Приносим свои извинения за неудобства — мы работаем над тем, чтобы как можно скорее возобновить обслуживание.<br /><br />
            Пожалуйста, загляните к нам немного позже. 🙏
          </p>
        </div>
      </div>
    );
  }

  // ── Экран: Таймер истёк ───────────────────────────────────────────────────
  if (timedOut) {
    return (
      <div className="mobile-view animate-slide-up" style={{ textAlign: 'center', marginTop: '4rem' }}>
        <div className="glass-panel" style={{ padding: '3rem 2rem', border: '1px solid rgba(245,158,11,0.3)' }}>
          <div style={{ color: 'var(--color-warning)', marginBottom: '1.5rem' }}>
            <AlertTriangle size={64} style={{ margin: '0 auto' }} />
          </div>
          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>Время вышло</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.7 }}>
            Ваша очередь была отменена, так как вы не успели подтвердить приезд вовремя.<br /><br />
            Если вы уже на месте — <strong style={{ color: 'var(--text-primary)' }}>обратитесь к оператору</strong>, он сможет восстановить вашу очередь. Или вы можете встать заново.
          </p>
          <button className="btn btn-primary btn-block" onClick={handleRegisterNew}>
            Встать в очередь заново
          </button>
        </div>
      </div>
    );
  }

  // ── Экран: Мойка завершена ────────────────────────────────────────────────
  if (myTicket?.status === 'completed') {
    return (
      <div className="mobile-view animate-slide-up" style={{ textAlign: 'center', marginTop: '4rem' }}>
        <div className="glass-panel" style={{ padding: '3rem 2rem' }}>
          <div style={{ color: 'var(--color-success)', marginBottom: '1.5rem' }}>
            <CheckCircle size={64} style={{ margin: '0 auto' }} />
          </div>
          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>Мойка завершена!</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.5 }}>
            Спасибо, что воспользовались нашими услугами. Ваш автомобиль готов.
          </p>
          <button className="btn btn-primary btn-block" onClick={handleRegisterNew}>
            Записаться снова
          </button>
        </div>
      </div>
    );
  }

  // ── Экран: Отменено вручную ───────────────────────────────────────────────
  if (myTicket?.status === 'cancelled' && !timedOut) {
    return (
      <div className="mobile-view animate-slide-up" style={{ textAlign: 'center', marginTop: '4rem' }}>
        <div className="glass-panel" style={{ padding: '3rem 2rem' }}>
          <div style={{ color: 'var(--color-danger)', marginBottom: '1.5rem' }}>
            <XCircle size={64} style={{ margin: '0 auto' }} />
          </div>
          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>Запись отменена</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.5 }}>
            Вы покинули очередь. Вставайте заново если хотите помыть машину.
          </p>
          <button className="btn btn-primary btn-block" onClick={handleRegisterNew}>
            Встать в очередь заново
          </button>
        </div>
      </div>
    );
  }

  // ── Экран: Машина моется ──────────────────────────────────────────────────
  if (myTicket?.status === 'in_box') {
    return (
      <div className="mobile-view animate-slide-up">
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontFamily: 'var(--font-heading)' }}>{business.name}</h1>
          {business.address && (
            <p style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', fontSize: '0.875rem' }}>
              <MapPin size={14} /> {business.address}
            </p>
          )}
        </div>
        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
          <div style={{ color: 'var(--color-success)', marginBottom: '1.5rem' }}>
            <Car size={64} style={{ margin: '0 auto' }} />
          </div>
          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>Ваша машина моется</h2>
          <p style={{ fontSize: '1.1rem', fontFamily: 'monospace', fontWeight: 'bold', marginBottom: '0.5rem' }}>
            {myTicket.plate_number}
          </p>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Пожалуйста, ожидайте. Оператор сообщит когда машина будет готова.
          </p>
        </div>
      </div>
    );
  }

  // ── Экран: Ожидание / Вызов ───────────────────────────────────────────────
  if (myTicket?.status === 'waiting' || myTicket?.status === 'confirmed') {
    return (
      <div className="mobile-view animate-slide-up">

        {showCallAlert && (
          <div className="alert-popup">
            <div className="alert-card" style={{ textAlign: 'center' }}>
              <div style={{ color: 'var(--color-success)', marginBottom: '1.25rem' }}>
                <CheckCircle size={64} style={{ margin: '0 auto' }} />
              </div>
              <h2 style={{ fontSize: '2rem', marginBottom: '0.75rem', color: 'white' }}>Ваша очередь!</h2>
              <p style={{ fontSize: '1.25rem', color: 'var(--color-success)', fontWeight: 700, marginBottom: '1.5rem' }}>
                Заезжайте
              </p>
              <div style={{ fontSize: '2.5rem', fontWeight: 900, fontFamily: 'monospace', color: 'white', marginBottom: '1.5rem' }}>
                {formatCountdown(callCountdown)}
              </div>
              <button className="btn btn-success btn-block" style={{ fontSize: '1.1rem', padding: '1rem' }} onClick={handleConfirmArrival}>
                Еду!
              </button>
            </div>
          </div>
        )}

        {showCancelConfirm && (
          <div className="modal-overlay">
            <div className="modal-content" style={{ textAlign: 'center' }}>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>Вы уверены?</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.4 }}>
                Вы покинете очередь и потеряете своё место.
              </p>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button className="btn btn-danger" style={{ flex: 1 }} onClick={handleCancelQueue}>Да, отменить</button>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowCancelConfirm(false)}>Нет</button>
              </div>
            </div>
          </div>
        )}

        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontFamily: 'var(--font-heading)' }}>{business.name}</h1>
          {business.address && (
            <p style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', fontSize: '0.875rem' }}>
              <MapPin size={14} /> {business.address}
            </p>
          )}
        </div>

        <div className="glass-panel" style={{ textAlign: 'center', marginBottom: '1.5rem', border: '1px solid var(--accent-color)', padding: '2rem' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.25rem' }}>Ваш автомобиль</p>
          <div style={{ fontSize: '2rem', fontFamily: 'monospace', fontWeight: 'bold', marginBottom: '1.5rem' }}>
            {myTicket.plate_number}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Перед вами</p>
              <p style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'var(--font-heading)' }}>
                {queueAheadCount}
                <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-secondary)', marginLeft: '0.25rem' }}>машин</span>
              </p>
            </div>
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Ожидание</p>
              <p style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-warning)', fontFamily: 'var(--font-heading)' }}>
                ~{estimatedWait()}
                <span style={{ fontSize: '1rem', fontWeight: 500, marginLeft: '0.25rem' }}>мин</span>
              </p>
            </div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem', fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5, textAlign: 'center' }}>
          🔔 Не закрывайте страницу — когда подойдёт ваша очередь, здесь появится уведомление
        </div>

        <button className="btn btn-danger btn-block" onClick={() => setShowCancelConfirm(true)}>
          <LogOut size={16} /> Отменить запись
        </button>
      </div>
    );
  }

  // ── Экран: Регистрация ────────────────────────────────────────────────────
  return (
    <div className="mobile-view animate-slide-up">
      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <h1 style={{ fontSize: '2rem', fontFamily: 'var(--font-heading)', marginBottom: '0.5rem' }}>Запись в очередь</h1>
        <p style={{ color: 'var(--text-secondary)' }}>{business.name}</p>
        {business.address && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', marginTop: '0.25rem' }}>
            <MapPin size={12} /> {business.address}
          </p>
        )}
      </div>

      <div className="glass-panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem', textAlign: 'center' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--accent-color)', marginBottom: '0.25rem' }}>
            <Car size={22} />
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Машин в очереди</p>
          <p style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-heading)' }}>{queueAheadCount}</p>
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-warning)', marginBottom: '0.25rem' }}>
            <Clock size={22} />
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Ожидание</p>
          <p style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--color-warning)', fontFamily: 'var(--font-heading)' }}>
            ~{estimatedWait()} <span style={{ fontSize: '1rem', fontWeight: 600 }}>мин</span>
          </p>
        </div>
      </div>

      <div className="glass-panel">
        <h3 style={{ fontSize: '1.1rem', marginBottom: '1.25rem' }}>Введите номер автомобиля</h3>
        <form onSubmit={handleJoinQueue} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Гос. номер *
            </label>
            <div style={{ position: 'relative' }}>
              <Car size={18} style={{ position: 'absolute', left: '12px', top: '16px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                required
                placeholder="А777АА177"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
                style={{ paddingLeft: '2.5rem', textTransform: 'uppercase' }}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Проверяем...' : 'Встать в очередь'} <ArrowRight size={18} />
          </button>
        </form>
      </div>

      <p style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
        Не закрывайте страницу — здесь вы узнаете когда заезжать
      </p>
    </div>
  );
}
