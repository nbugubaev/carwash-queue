import React, { useState, useEffect } from 'react';
import { getSupabase } from '../supabase';
import { RefreshCw, LogOut, Users, Car, TrendingUp, Clock, CheckCircle, XCircle, AlertTriangle, BarChart2 } from 'lucide-react';

const ADMIN_EMAILS = ['your@email.com']; // ← замени на свои email

const RANGES = [
  { label: 'Сегодня', value: 'today' },
  { label: '7 дней', value: '7days' },
  { label: '30 дней', value: '30days' },
];

function getDateFrom(range) {
  const now = new Date();
  if (range === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (range === '7days') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const d = new Date(now);
  d.setDate(d.getDate() - 30);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function AdminDashboard({ onLogout }) {
  const supabase = getSupabase();
  const [session, setSession] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);

  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [range, setRange] = useState('30days');

  // ── Данные ───────────────────────────────────────────────────────────────
  const [totalBusinesses, setTotalBusinesses] = useState(0);
  const [newBusinesses, setNewBusinesses] = useState(0);
  const [activeBusinesses, setActiveBusinesses] = useState(0);
  const [queueStats, setQueueStats] = useState({
    total: 0, completed: 0, cancelledTimer: 0, cancelledSelf: 0,
    conversionRate: 0, avgWaitMin: 0, avgWashMin: 0, avgConfirmSec: 0,
  });
  const [funnel, setFunnel] = useState({ total: 0, invited: 0, confirmed: 0, completed: 0 });
  const [hourlyData, setHourlyData] = useState([]);
  const [topBusinesses, setTopBusinesses] = useState([]);
  const [retentionData, setRetentionData] = useState([]);

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        if (!ADMIN_EMAILS.includes(session.user.email)) {
          setAccessDenied(true);
        } else {
          setSession(session);
        }
      }
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) {
        if (!ADMIN_EMAILS.includes(session.user.email)) {
          setAccessDenied(true);
          setSession(null);
        } else {
          setAccessDenied(false);
          setSession(session);
        }
      } else {
        setSession(null);
        setAccessDenied(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (session) fetchStats();
  }, [session, range]);

  // ── Загрузка статистики ───────────────────────────────────────────────────

  const fetchStats = async () => {
    setStatsLoading(true);
    try {
      const dateFrom = getDateFrom(range);
      const now = new Date().toISOString();

      // Все бизнесы
      const { data: businesses } = await supabase.from('businesses').select('id, name, created_at');
      const total = businesses?.length || 0;
      const newBiz = businesses?.filter(b => b.created_at >= dateFrom).length || 0;
      setTotalBusinesses(total);
      setNewBusinesses(newBiz);

      // Очередь за период
      const { data: queueData } = await supabase
        .from('queue')
        .select('*')
        .gte('joined_at', dateFrom);

      const q = queueData || [];

      // Активные мойки (уникальные business_id в очереди за период)
      const activeBizIds = new Set(q.map(i => i.business_id));
      setActiveBusinesses(activeBizIds.size);

      // Статистика очереди
      const completed = q.filter(i => i.status === 'completed');
      const cancelledTimer = q.filter(i => i.status === 'cancelled' && i.invited_at);
      const cancelledSelf = q.filter(i => i.status === 'cancelled' && !i.invited_at);
      const conversionRate = q.length > 0 ? Math.round((completed.length / q.length) * 100) : 0;

      // Среднее время ожидания (joined_at → invited_at)
      const waitTimes = q
        .filter(i => i.invited_at && i.joined_at)
        .map(i => (new Date(i.invited_at) - new Date(i.joined_at)) / 60000);
      const avgWaitMin = waitTimes.length > 0
        ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
        : 0;

      // Среднее время мойки (started_at → completed_at)
      const washTimes = completed
        .filter(i => i.started_at && i.completed_at)
        .map(i => (new Date(i.completed_at) - new Date(i.started_at)) / 60000);
      const avgWashMin = washTimes.length > 0
        ? Math.round(washTimes.reduce((a, b) => a + b, 0) / washTimes.length)
        : 0;

      // Среднее время подтверждения (invited_at → presence_confirmed)
      // Считаем по машинам у которых presence_confirmed = true
      const confirmTimes = q
        .filter(i => i.presence_confirmed && i.invited_at && i.started_at)
        .map(i => (new Date(i.started_at) - new Date(i.invited_at)) / 1000);
      const avgConfirmSec = confirmTimes.length > 0
        ? Math.round(confirmTimes.reduce((a, b) => a + b, 0) / confirmTimes.length)
        : 0;

      setQueueStats({
        total: q.length,
        completed: completed.length,
        cancelledTimer: cancelledTimer.length,
        cancelledSelf: cancelledSelf.length,
        conversionRate,
        avgWaitMin,
        avgWashMin,
        avgConfirmSec,
      });

      // Воронка
      const invited = q.filter(i => i.invited_at).length;
      const confirmedCount = q.filter(i => i.presence_confirmed).length;
      setFunnel({ total: q.length, invited, confirmed: confirmedCount, completed: completed.length });

      // Почасовой график (среднее по часам)
      const hourCounts = Array(24).fill(0);
      const hourDays = Array(24).fill(0);
      const daySet = new Set();
      q.forEach(item => {
        const d = new Date(item.joined_at);
        const hour = d.getHours();
        const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        hourCounts[hour]++;
        daySet.add(dayKey);
      });
      const totalDays = Math.max(1, daySet.size);
      setHourlyData(hourCounts.map((count, hour) => ({
        hour,
        avg: Math.round((count / totalDays) * 10) / 10,
        total: count,
      })));

      // Топ 5 моек
      const bizMap = {};
      completed.forEach(item => {
        bizMap[item.business_id] = (bizMap[item.business_id] || 0) + 1;
      });
      const top = Object.entries(bizMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, count]) => ({
          id,
          name: businesses?.find(b => b.id === id)?.name || id,
          count,
        }));
      setTopBusinesses(top);

      // Retention — активность моек по дням
      if (range !== 'today') {
        const days = range === '7days' ? 7 : 30;
        const retention = [];
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          d.setHours(0, 0, 0, 0);
          const nextD = new Date(d);
          nextD.setDate(nextD.getDate() + 1);
          const dayStr = d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
          const activeBiz = new Set(
            q.filter(item => {
              const t = new Date(item.joined_at);
              return t >= d && t < nextD;
            }).map(item => item.business_id)
          ).size;
          retention.push({ day: dayStr, active: activeBiz });
        }
        setRetentionData(retention);
      } else {
        setRetentionData([]);
      }

    } catch (err) {
      console.error('Error fetching admin stats:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}?role=admin`
        }
      });
      if (error) throw error;
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    if (onLogout) onLogout();
  };

  // ── Вспомогательные ──────────────────────────────────────────────────────

  const funnelPct = (val) => funnel.total > 0 ? Math.round((val / funnel.total) * 100) : 0;
  const maxHourly = Math.max(...hourlyData.map(h => h.avg), 1);
  const maxRetention = Math.max(...retentionData.map(d => d.active), 1);

  // ── Рендер ───────────────────────────────────────────────────────────────

  if (!supabase) return <div style={{ padding: '2rem', textAlign: 'center' }}>Supabase не настроен.</div>;

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <RefreshCw size={40} style={{ animation: 'spin 1.5s linear infinite' }} />
      </div>
    );
  }

  // ── Доступ запрещён ───────────────────────────────────────────────────────
  if (accessDenied) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <div className="glass-panel" style={{ maxWidth: 400, textAlign: 'center', padding: '3rem 2rem' }}>
          <div style={{ color: 'var(--color-danger)', marginBottom: '1rem' }}>
            <XCircle size={48} style={{ margin: '0 auto' }} />
          </div>
          <h2 style={{ marginBottom: '0.75rem' }}>Доступ запрещён</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            Этот раздел доступен только разработчикам.
          </p>
          <button className="btn btn-secondary btn-block" onClick={handleSignOut}>
            <LogOut size={16} /> Выйти
          </button>
        </div>
      </div>
    );
  }

  // ── Логин ─────────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh' }}>
        <div className="glass-panel config-container animate-slide-up">
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{ display: 'inline-flex', padding: '1rem', borderRadius: '50%', background: 'rgba(99,102,241,0.1)', color: 'var(--accent-color)', marginBottom: '1rem' }}>
              <BarChart2 size={40} />
            </div>
            <h2 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Dev Dashboard</h2>
            <p style={{ color: 'var(--text-secondary)' }}>Только для разработчиков</p>
          </div>
          {authError && <p style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginBottom: '1rem', textAlign: 'center' }}>⚠️ {authError}</p>}
          <button
            className="btn btn-primary btn-block"
            disabled={authLoading}
            onClick={handleAuth}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', fontSize: '1rem', padding: '0.875rem' }}
          >
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
              <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
              <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
              <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
            </svg>
            {authLoading ? 'Перенаправление...' : 'Войти через Google'}
          </button>
        </div>
      </div>
    );
  }

  // ── Дашборд ───────────────────────────────────────────────────────────────
  return (
    <div className="container animate-slide-up" style={{ paddingBottom: '5rem' }}>

      {/* Шапка */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <BarChart2 size={28} color="var(--accent-color)" /> Dev Dashboard
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Аналитика платформы · {session.user.email}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Переключатель периода */}
          <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '0.25rem', border: '1px solid var(--border-color)' }}>
            {RANGES.map(r => (
              <button key={r.value} onClick={() => setRange(r.value)} style={{
                background: range === r.value ? 'var(--accent-color)' : 'none',
                border: 'none', color: 'white', cursor: 'pointer',
                padding: '0.375rem 0.875rem', borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem', fontWeight: 500, transition: 'background 0.2s',
              }}>{r.label}</button>
            ))}
          </div>
          <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }} onClick={fetchStats} disabled={statsLoading}>
            <RefreshCw size={15} style={{ animation: statsLoading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
          <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }} onClick={handleSignOut}>
            <LogOut size={15} /> Выйти
          </button>
        </div>
      </div>

      {/* ── БЛОК 1: Охват ─────────────────────────────────────────────────── */}
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Охват платформы</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
        {[
          { icon: <Users size={22} />, label: 'Всего моек', value: totalBusinesses, color: 'var(--accent-color)' },
          { icon: <TrendingUp size={22} />, label: `Новых моек за период`, value: newBusinesses, color: 'var(--color-success)' },
          { icon: <CheckCircle size={22} />, label: 'Активных моек за период', value: activeBusinesses, color: 'var(--color-info)' },
        ].map((card, i) => (
          <div key={i} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ color: card.color, flexShrink: 0 }}>{card.icon}</div>
            <div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginBottom: '0.25rem' }}>{card.label}</p>
              <p style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: card.color }}>
                {statsLoading ? '...' : card.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ── БЛОК 2: Машины ────────────────────────────────────────────────── */}
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Машины за период</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
        {[
          { label: 'Всего записей', value: queueStats.total, color: 'var(--text-primary)' },
          { label: 'Обслужено', value: queueStats.completed, color: 'var(--color-success)' },
          { label: 'Отменено (таймер)', value: queueStats.cancelledTimer, color: 'var(--color-warning)' },
          { label: 'Отменено (сами)', value: queueStats.cancelledSelf, color: 'var(--color-danger)' },
          { label: 'Конверсия', value: `${queueStats.conversionRate}%`, color: 'var(--accent-color)' },
        ].map((card, i) => (
          <div key={i} className="glass-panel" style={{ padding: '1.5rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginBottom: '0.5rem' }}>{card.label}</p>
            <p style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: card.color }}>
              {statsLoading ? '...' : card.value}
            </p>
          </div>
        ))}
      </div>

      {/* ── БЛОК 3: Среднее время ──────────────────────────────────────────── */}
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Среднее время</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2.5rem' }}>
        {[
          { icon: <Clock size={20} />, label: 'Ожидание в очереди', value: `${queueStats.avgWaitMin} мин`, color: 'var(--color-warning)' },
          { icon: <Car size={20} />, label: 'Время мойки', value: `${queueStats.avgWashMin} мин`, color: 'var(--color-success)' },
          { icon: <CheckCircle size={20} />, label: 'Подтверждение приезда', value: `${queueStats.avgConfirmSec} сек`, color: 'var(--color-info)' },
        ].map((card, i) => (
          <div key={i} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ color: card.color, flexShrink: 0 }}>{card.icon}</div>
            <div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginBottom: '0.25rem' }}>{card.label}</p>
              <p style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-heading)', color: card.color }}>
                {statsLoading ? '...' : card.value}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ── БЛОК 4: Воронка ───────────────────────────────────────────────── */}
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Воронка</h2>
      <div className="glass-panel" style={{ marginBottom: '2.5rem', padding: '1.75rem' }}>
        {statsLoading ? <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Загрузка...</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {[
              { label: 'Встали в очередь', value: funnel.total, pct: 100, color: 'var(--accent-color)' },
              { label: 'Получили вызов', value: funnel.invited, pct: funnelPct(funnel.invited), color: 'var(--color-info)' },
              { label: 'Подтвердили приезд', value: funnel.confirmed, pct: funnelPct(funnel.confirmed), color: 'var(--color-warning)' },
              { label: 'Помылись', value: funnel.completed, pct: funnelPct(funnel.completed), color: 'var(--color-success)' },
            ].map((step, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{step.label}</span>
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: step.color }}>{step.value} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({step.pct}%)</span></span>
                </div>
                <div style={{ height: 8, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${step.pct}%`, background: step.color, borderRadius: 4, transition: 'width 0.5s' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── БЛОК 5: Почасовой график ──────────────────────────────────────── */}
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Часы пик (среднее машин/час)</h2>
      <div className="glass-panel" style={{ marginBottom: '2.5rem', padding: '1.75rem' }}>
        {statsLoading ? <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Загрузка...</p> : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: 120 }}>
            {hourlyData.map(({ hour, avg }) => (
              <div key={hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div
                  title={`${hour}:00 — ${avg} машин`}
                  style={{
                    width: '100%',
                    height: `${Math.round((avg / maxHourly) * 100)}px`,
                    minHeight: avg > 0 ? 4 : 0,
                    background: avg > 0 ? 'var(--accent-color)' : 'var(--bg-tertiary)',
                    borderRadius: '3px 3px 0 0',
                    opacity: avg > 0 ? 0.7 + (avg / maxHourly) * 0.3 : 0.3,
                    transition: 'height 0.3s',
                    cursor: 'default',
                  }}
                />
                {hour % 4 === 0 && (
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{hour}:00</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── БЛОК 6: Топ 5 моек ────────────────────────────────────────────── */}
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Топ 5 моек по обслуженным машинам</h2>
      <div className="glass-panel" style={{ marginBottom: '2.5rem', padding: '0' }}>
        {statsLoading ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>Загрузка...</p>
        ) : topBusinesses.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>Нет данных за период</p>
        ) : (
          <table className="custom-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Мойка</th>
                <th>Обслужено машин</th>
              </tr>
            </thead>
            <tbody>
              {topBusinesses.map((biz, idx) => (
                <tr key={biz.id}>
                  <td style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{idx + 1}</td>
                  <td style={{ fontWeight: 600 }}>{biz.name}</td>
                  <td>
                    <span style={{ color: 'var(--color-success)', fontWeight: 700, fontSize: '1.1rem' }}>{biz.count}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── БЛОК 7: Retention ─────────────────────────────────────────────── */}
      {range !== 'today' && (
        <>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Активность моек по дням (retention)
          </h2>
          <div className="glass-panel" style={{ marginBottom: '2.5rem', padding: '1.75rem' }}>
            {statsLoading ? <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Загрузка...</p> : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: 100 }}>
                {retentionData.map(({ day, active }) => (
                  <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div
                      title={`${day} — ${active} моек`}
                      style={{
                        width: '100%',
                        height: `${Math.round((active / maxRetention) * 80)}px`,
                        minHeight: active > 0 ? 4 : 0,
                        background: active > 0 ? 'var(--color-success)' : 'var(--bg-tertiary)',
                        borderRadius: '3px 3px 0 0',
                        opacity: active > 0 ? 0.6 + (active / maxRetention) * 0.4 : 0.3,
                        transition: 'height 0.3s',
                        cursor: 'default',
                      }}
                    />
                    {retentionData.length <= 10 && (
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{day}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

    </div>
  );
}
