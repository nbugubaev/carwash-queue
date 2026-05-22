import React, { useState, useEffect } from 'react';
import { getSupabase } from '../supabase';
import { 
  Car, Clock, CheckCircle, AlertTriangle, 
  MapPin, LogOut, ArrowRight, UserCheck, XCircle, RefreshCw 
} from 'lucide-react';

export default function ClientPanel({ businessId }) {
  const supabase = getSupabase();
  const [business, setBusiness] = useState(null);
  const [queue, setQueue] = useState([]);
  const [myQueueId, setMyQueueId] = useState(() => localStorage.getItem(`client_queue_id_${businessId}`));
  const [myTicket, setMyTicket] = useState(null);
  
  // Registration Form State
  const [plateNumber, setPlateNumber] = useState('');

  const [submitting, setSubmitting] = useState(false);

  // States for alerts
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmCountdown, setConfirmCountdown] = useState(60);
  const [presenceAlertTriggered, setPresenceAlertTriggered] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load business data & queue
  useEffect(() => {
    if (!supabase || !businessId) return;

    const init = async () => {
      setLoading(true);
      try {
        // Fetch business info
        const { data: busData, error: busErr } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', businessId)
          .single();

        if (busErr) throw busErr;
        setBusiness(busData);

        // Fetch active queue
        await fetchQueue();
      } catch (err) {
        console.error('Error loading client panel:', err);
      } finally {
        setLoading(false);
      }
    };

    init();

    // Subscribe to realtime changes in the queue
    const channel = supabase
      .channel('client-queue-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'queue',
          filter: `business_id=eq.${businessId}`
        },
        async () => {
          await fetchQueue();
        }
      )
      .subscribe();

    // Subscribe to business configuration changes
    const busChannel = supabase
      .channel('client-business-changes')
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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(busChannel);
    };
  }, [businessId, supabase]);

  // Sync ticket details once queue or myQueueId updates
  useEffect(() => {
    if (myQueueId && queue.length > 0) {
      const ticket = queue.find(item => item.id === myQueueId);
      if (ticket) {
        setMyTicket(ticket);
      } else {
        // Ticket is no longer active in the active list (could be completed or cancelled)
        // Let's query Supabase to see if it was completed or cancelled
        checkPastTicketStatus();
      }
    } else {
      setMyTicket(null);
    }
  }, [myQueueId, queue]);

  // Alert 1 (Confirm Presence Modal) & Auto-Cancel Countdown
  useEffect(() => {
    if (!myTicket || myTicket.status !== 'waiting' || myTicket.presence_confirmed) {
      setShowConfirmModal(false);
      return;
    }

    // Determine position in the waiting list
    const waitingQueue = queue.filter(item => item.status === 'waiting');
    const myIndex = waitingQueue.findIndex(item => item.id === myTicket.id);

    // If within top 2 positions (index 0 or 1), prompt for confirmation
    if (myIndex !== -1 && myIndex <= 1) {
      if (!presenceAlertTriggered) {
        setShowConfirmModal(true);
        setPresenceAlertTriggered(true);
        setConfirmCountdown(60); // Reset countdown to 60s
        
        // Update invited_at in database if not set
        if (!myTicket.invited_at) {
          supabase
            .from('queue')
            .update({ invited_at: new Date().toISOString() })
            .eq('id', myTicket.id)
            .then(() => {});
        }
      }
    } else {
      // If queue shifted and we are somehow pushed back, hide modal
      setShowConfirmModal(false);
    }
  }, [myTicket, queue, presenceAlertTriggered]);

  // Countdown timer logic
  useEffect(() => {
    let interval = null;
    if (showConfirmModal && confirmCountdown > 0) {
      interval = setInterval(() => {
        setConfirmCountdown(prev => prev - 1);
      }, 1000);
    } else if (showConfirmModal && confirmCountdown === 0) {
      // Countdown reached 0: Auto-cancel client
      handleCancelQueue(true); // true = auto-cancelled
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showConfirmModal, confirmCountdown]);

  const fetchQueue = async () => {
    try {
      const { data, error } = await supabase
        .from('queue')
        .select('*')
        .eq('business_id', businessId)
        .in('status', ['waiting', 'in_box'])
        .order('joined_at', { ascending: true });

      if (error) throw error;
      setQueue(data || []);
    } catch (err) {
      console.error('Error fetching queue:', err);
    }
  };

  const checkPastTicketStatus = async () => {
    try {
      const { data, error } = await supabase
        .from('queue')
        .select('*')
        .eq('id', myQueueId)
        .single();
      
      if (error) throw error;
      if (data) {
        if (data.status === 'completed' || data.status === 'cancelled') {
          setMyTicket(data); // set the historical ticket so we can show Completed or Cancelled screens
        }
      }
    } catch (err) {
      console.error('Error fetching historical ticket status:', err);
    }
  };

  const handleJoinQueue = async (e) => {
    e.preventDefault();
    if (!plateNumber.trim() || submitting) return;
    setSubmitting(true);

    try {
      const { data, error } = await supabase
        .from('queue')
        .insert([{
          business_id: businessId,
          plate_number: plateNumber.trim().toUpperCase(),
          phone_number: null,
          status: 'waiting',
          presence_confirmed: false
        }])
        .select();

      if (error) throw error;

      if (data && data.length > 0) {
        const ticketId = data[0].id;
        localStorage.setItem(`client_queue_id_${businessId}`, ticketId);
        setMyQueueId(ticketId);
        setMyTicket(data[0]);
        setPresenceAlertTriggered(false);
      }
    } catch (err) {
      alert('Ошибка при записи в очередь: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmPresence = async () => {
    if (!myTicket) return;
    try {
      const { error } = await supabase
        .from('queue')
        .update({ presence_confirmed: true })
        .eq('id', myTicket.id);

      if (error) throw error;
      setShowConfirmModal(false);
    } catch (err) {
      console.error('Error confirming presence:', err);
    }
  };

  const handleCancelQueue = async (isAuto = false) => {
    const ticketId = myTicket?.id || myQueueId;
    if (!ticketId) return;

    try {
      const { error } = await supabase
        .from('queue')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString()
        })
        .eq('id', ticketId);

      if (error) throw error;
      
      // Cleanup localStorage
      localStorage.removeItem(`client_queue_id_${businessId}`);
      setMyQueueId(null);
      setMyTicket(null);
      setPresenceAlertTriggered(false);
      setShowConfirmModal(false);

      if (isAuto) {
        alert('Вы были автоматически удалены из очереди, так как не подтвердили свое присутствие вовремя.');
      }
    } catch (err) {
      console.error('Error cancelling queue:', err);
    }
  };

  const handleRegisterNew = () => {
    localStorage.removeItem(`client_queue_id_${businessId}`);
    setMyQueueId(null);
    setMyTicket(null);
    setPresenceAlertTriggered(false);
    setPlateNumber('');
  };

  // CALCULATE queue variables
  const waitingQueue = queue.filter(item => item.status === 'waiting');
  const totalInQueue = waitingQueue.length;
  const offlineCount = business?.offline_boxes?.length || 0;
  const activeBoxes = Math.max(1, (business?.boxes_count || 4) - offlineCount);
  const baseTime = business?.base_wash_time || 30;

  // Find client position in waiting queue
  const myWaitingIndex = myTicket && myTicket.status === 'waiting'
    ? waitingQueue.findIndex(item => item.id === myTicket.id)
    : -1;

  // Estimated wait time formula:
  // For new registration: Math.round((totalInQueue + 1) / activeBoxes) * baseTime
  const initialWaitTime = Math.round((totalInQueue + 1) / activeBoxes * baseTime);

  // For current position: Math.round((myWaitingIndex + 1) / activeBoxes) * baseTime
  const myWaitTime = myTicket && myTicket.status === 'waiting'
    ? Math.max(3, Math.round((myWaitingIndex + 1) / activeBoxes * baseTime))
    : 0;

  if (loading || !business) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <RefreshCw className="pulse-primary" size={40} style={{ animation: 'spin 1.5s linear infinite' }} />
      </div>
    );
  }

  // 1. COMPLETED SCREEN
  if (myTicket && myTicket.status === 'completed') {
    return (
      <div className="mobile-view text-center animate-slide-up" style={{ textAlign: 'center', marginTop: '4rem' }}>
        <div className="glass-panel" style={{ padding: '3rem 2rem' }}>
          <div style={{ color: 'var(--color-success)', marginBottom: '1.5rem' }}>
            <CheckCircle size={64} style={{ margin: '0 auto' }} />
          </div>
          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>Мойка завершена!</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: '1.5' }}>
            Спасибо, что воспользовались нашими услугами. Ваш автомобиль готов, забирайте из бокса №{myTicket.box_number}.
          </p>
          <button className="btn btn-primary btn-block" onClick={handleRegisterNew}>
            Записаться снова
          </button>
        </div>
      </div>
    );
  }

  // 2. CANCELLED SCREEN
  if (myTicket && myTicket.status === 'cancelled') {
    return (
      <div className="mobile-view text-center animate-slide-up" style={{ textAlign: 'center', marginTop: '4rem' }}>
        <div className="glass-panel" style={{ padding: '3rem 2rem' }}>
          <div style={{ color: 'var(--color-danger)', marginBottom: '1.5rem' }}>
            <XCircle size={64} style={{ margin: '0 auto' }} />
          </div>
          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>Запись отменена</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: '1.5' }}>
            Вы покинули очередь или запись была аннулирована из-за отсутствия подтверждения.
          </p>
          <button className="btn btn-primary btn-block" onClick={handleRegisterNew}>
            Занять очередь заново
          </button>
        </div>
      </div>
    );
  }

  // 3. TRACKING SCREEN (IF TICKET ACTIVE IN WAITING OR IN_BOX)
  if (myTicket) {
    const isWaiting = myTicket.status === 'waiting';
    const isInBox = myTicket.status === 'in_box';

    // Queue context: 2 before me, me, 2 after me
    const myAbsoluteIndex = waitingQueue.findIndex(item => item.id === myTicket.id);
    const contextStart = Math.max(0, myAbsoluteIndex - 2);
    const contextEnd = Math.min(waitingQueue.length - 1, myAbsoluteIndex + 2);
    const queueContext = waitingQueue.slice(contextStart, contextEnd + 1);

    // Calculate progress bar steps
    // Steps: 1 (In Queue) -> 2 (Prepare/Ready) -> 3 (In Box) -> 4 (Done)
    let activeStepIndex = 0;
    if (isWaiting && !myTicket.presence_confirmed) activeStepIndex = 0;
    else if (isWaiting && myTicket.presence_confirmed) activeStepIndex = 1;
    else if (isInBox) activeStepIndex = 2;

    const progressPercent = activeStepIndex * 50; // 0%, 50%, 100%

    return (
      <div className="mobile-view animate-slide-up">
        {/* Alert 2: Drive into Box */}
        {isInBox && (
          <div className="alert-popup">
            <div className="alert-card">
              <div style={{ color: 'var(--color-success)', marginBottom: '1.25rem' }}>
                <CheckCircle size={64} style={{ margin: '0 auto' }} />
              </div>
              <h2 style={{ fontSize: '2rem', marginBottom: '1rem', color: 'white' }}>Ваша очередь!</h2>
              <div style={{ 
                fontSize: '1.5rem', 
                backgroundColor: 'rgba(255, 255, 255, 0.05)', 
                padding: '1.5rem', 
                borderRadius: 'var(--radius-md)',
                border: '2px dashed var(--color-success)',
                fontWeight: '800',
                color: 'var(--color-success)',
                marginBottom: '1.5rem'
              }}>
                ЗАЕЗЖАЙТЕ В БОКС №{myTicket.box_number}
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: '1.4' }}>
                Пожалуйста, аккуратно двигайтесь в указанный бокс. Оператор уже ждет вас.
              </p>
            </div>
          </div>
        )}

        {/* Alert 1: Confirm Presence Countdown Modal */}
        {showConfirmModal && (
          <div className="alert-popup">
            <div className="alert-card" style={{ borderColor: 'var(--color-warning)', boxShadow: '0 0 20px rgba(245, 158, 11, 0.25)' }}>
              <div style={{ color: 'var(--color-warning)', marginBottom: '1rem' }}>
                <AlertTriangle size={56} style={{ margin: '0 auto' }} />
              </div>
              <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'white' }}>Подтвердите готовность</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: '1.4', marginBottom: '1rem' }}>
                🚗 Ваша очередь скоро подойдет! Подтвердите, что вы на месте и готовы заехать в бокс.
              </p>
              
              <div className="countdown-number">
                {confirmCountdown}с
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.5rem' }}>
                <button className="btn btn-success" onClick={handleConfirmPresence}>
                  <UserCheck size={18} /> Я на месте
                </button>
                <button className="btn btn-danger" onClick={() => handleCancelQueue(false)}>
                  Отменить запись
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontFamily: 'var(--font-heading)' }}>{business.name}</h1>
          <p style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', fontSize: '0.875rem' }}>
            <MapPin size={14} /> {business.address || 'Онлайн-мониторинг'}
          </p>
        </div>

        {/* Current status ticket */}
        <div className="glass-panel text-center" style={{ textAlign: 'center', marginBottom: '2rem', border: '1px solid var(--accent-color)' }}>
          <span className="badge badge-info" style={{ marginBottom: '0.5rem' }}>
            {isInBox ? `Вы в боксе №${myTicket.box_number}` : 'Вы в очереди'}
          </span>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Гос. Номер</p>
          <div style={{ fontSize: '2rem', fontFamily: 'monospace', fontWeight: 'bold', margin: '0.25rem 0 1rem 0' }}>
            {myTicket.plate_number}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Очередь</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', fontFamily: 'var(--font-heading)' }}>
                {isWaiting ? `№ ${myWaitingIndex + 1}` : '—'}
              </p>
            </div>
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Ожидание</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--color-warning)', fontFamily: 'var(--font-heading)' }}>
                {isWaiting ? `~${myWaitTime} мин` : '0 мин'}
              </p>
            </div>
          </div>
        </div>

        {/* Queue context: who is before/after me */}
        {isWaiting && queueContext.length > 0 && (
          <div className="glass-panel" style={{ marginBottom: '2rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>Очередь рядом с вами</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {queueContext.map((item, idx) => {
                const absolutePos = contextStart + idx;
                const isMe = item.id === myTicket.id;
                const isBefore = absolutePos < myAbsoluteIndex;
                return (
                  <div key={item.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.65rem 1rem',
                    borderRadius: 'var(--radius-sm)',
                    background: isMe ? 'rgba(99,102,241,0.18)' : isBefore ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.03)',
                    border: isMe ? '1.5px solid var(--accent-color)' : '1px solid var(--border-color)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontWeight: '700', fontSize: '0.85rem', color: isMe ? 'var(--accent-color)' : 'var(--text-muted)', minWidth: '2rem' }}>
                        №{absolutePos + 1}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontWeight: isMe ? '800' : '600', fontSize: isMe ? '1.05rem' : '0.95rem', color: isMe ? 'white' : 'var(--text-secondary)', letterSpacing: '0.05em' }}>
                        {item.plate_number}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {isMe && <span style={{ fontSize: '0.7rem', background: 'var(--accent-color)', color: 'white', borderRadius: '999px', padding: '0.15rem 0.55rem', fontWeight: '700' }}>ВЫ</span>}
                      {!isMe && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{isBefore ? 'впереди' : 'сзади'}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {waitingQueue.length > 5 && (
              <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                Всего в очереди: {waitingQueue.length} машин
              </p>
            )}
          </div>
        )}

        {/* Progress Bar */}
        <div className="glass-panel" style={{ marginBottom: '2rem' }}>
          <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Статус вашей мойки</h3>
          
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progressPercent}%` }}></div>
            
            <div className={`progress-step ${activeStepIndex >= 0 ? (activeStepIndex > 0 ? 'completed' : 'active') : ''}`}>
              <div className="step-node">1</div>
              <span className="step-label">В очереди</span>
            </div>

            <div className={`progress-step ${activeStepIndex >= 1 ? (activeStepIndex > 1 ? 'completed' : 'active') : ''}`}>
              <div className="step-node">2</div>
              <span className="step-label">Приготовьтесь</span>
            </div>

            <div className={`progress-step ${activeStepIndex >= 2 ? (activeStepIndex > 2 ? 'completed' : 'active') : ''}`}>
              <div className="step-node">3</div>
              <span className="step-label">В боксе</span>
            </div>
          </div>

          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            {isWaiting && !myTicket.presence_confirmed && (
              <span>Вы успешно зарегистрированы в очереди. Ожидайте вызова для подтверждения готовности.</span>
            )}
            {isWaiting && myTicket.presence_confirmed && (
              <span style={{ color: 'var(--color-success)', fontWeight: '500' }}>✓ Присутствие подтверждено! Автоматически заедете в первый освободившийся бокс.</span>
            )}
            {isInBox && (
              <span style={{ color: 'var(--color-info)', fontWeight: '500' }}>Машина находится в боксе №{myTicket.box_number}. Идет обслуживание.</span>
            )}
          </div>
        </div>

        {/* Stats indicators */}
        <div className="glass-panel" style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', padding: '1rem 1.5rem', fontSize: '0.875rem' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Активно боксов:</span>
          <strong>{activeBoxes} из {business.boxes_count}</strong>
        </div>

        {/* Actions */}
        <button 
          onClick={() => {
            if (confirm('Вы уверены, что хотите покинуть очередь? Ваше место будет потеряно.')) {
              handleCancelQueue(false);
            }
          }} 
          className="btn btn-danger btn-block"
        >
          <LogOut size={16} /> Покинуть очередь
        </button>
      </div>
    );
  }

  // 4. REGISTRATION SCREEN (IF NO TICKET REGISTERED)
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

      {/* Info Panel */}
      <div className="glass-panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '2rem', textAlign: 'center', border: '1px solid var(--border-color)' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--accent-color)', marginBottom: '0.25rem' }}>
            <Car size={24} />
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Машин в очереди</p>
          <p style={{ fontSize: '1.75rem', fontWeight: '800', fontFamily: 'var(--font-heading)' }}>{totalInQueue}</p>
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-warning)', marginBottom: '0.25rem' }}>
            <Clock size={24} />
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Время ожидания</p>
          <p style={{ fontSize: '1.75rem', fontWeight: '800', color: 'var(--color-warning)', fontFamily: 'var(--font-heading)' }}>
            {totalInQueue === 0 ? '0' : `~${initialWaitTime}`} <span style={{ fontSize: '1rem', fontWeight: '600' }}>мин</span>
          </p>
        </div>
      </div>

      {/* Registration Form */}
      <div className="glass-panel">
        <h3 style={{ fontSize: '1.1rem', marginBottom: '1.25rem' }}>Заполните данные для въезда</h3>

        <form onSubmit={handleJoinQueue} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Гос. Номер автомобиля *
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

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting} style={{ marginTop: '0.5rem' }}>
            {submitting ? 'Запись...' : 'Встать в очередь'} <ArrowRight size={18} />
          </button>
        </form>
      </div>

      <div style={{
        marginTop: '2rem',
        textAlign: 'center',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        lineHeight: '1.4'
      }}>
        Регистрируясь в очереди, вы соглашаетесь получать уведомления о статусе готовности автомобиля на этой веб-странице. Не закрывайте вкладку.
      </div>
    </div>
  );
}
