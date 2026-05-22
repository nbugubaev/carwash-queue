import React, { useState, useEffect } from 'react';
import { getSupabaseConfig, getSupabase } from './supabase';
import SupabaseConfig from './components/SupabaseConfig';
import OwnerDashboard from './components/OwnerDashboard';
import OperatorPanel from './components/OperatorPanel';
import ClientPanel from './components/ClientPanel';
import { Car, Shield, Clock, TrendingUp, QrCode, BarChart2, CheckCircle, ArrowRight, ChevronDown, Smartphone, Users, Zap, MapPin } from 'lucide-react';

// ── Landing page sections ──────────────────────────────────────────────────

function Hero({ onEnter }) {
  return (
    <section style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      padding: '2rem 1.5rem',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background glow blobs */}
      <div style={{ position: 'absolute', top: '-10%', left: '50%', transform: 'translateX(-50%)', width: '600px', height: '600px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: '760px' }}>
        {/* Badge */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '999px', padding: '0.35rem 1rem', fontSize: '0.8125rem', color: 'var(--accent-color)', marginBottom: '2rem', fontWeight: 600 }}>
          <Zap size={13} /> Электронная очередь для автомоек
        </div>

        <h1 style={{ fontSize: 'clamp(2.2rem, 6vw, 3.75rem)', fontFamily: 'var(--font-heading)', fontWeight: 900, lineHeight: 1.1, marginBottom: '1.25rem' }}>
          Больше никаких<br />
          <span style={{ background: 'linear-gradient(135deg, #6366F1, #8B5CF6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>живых очередей</span><br />
          у вашей мойки
        </h1>

        <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem', lineHeight: 1.6, maxWidth: '520px', margin: '0 auto 2.5rem' }}>
          Клиенты записываются через QR-код и ждут в машине. Оператор управляет боксами с планшета. Вы видите аналитику в реальном времени.
        </p>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" style={{ padding: '0.875rem 2rem', fontSize: '1rem', fontWeight: 700 }} onClick={onEnter}>
            Войти в кабинет <ArrowRight size={18} />
          </button>
          <a href="#how" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.875rem 1.5rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: '1rem', textDecoration: 'none', transition: 'border-color 0.2s' }}>
            Как это работает <ChevronDown size={16} />
          </a>
        </div>


      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { icon: <QrCode size={28} />, title: 'Клиент сканирует QR', desc: 'При въезде на мойку клиент сканирует QR-код телефоном и вводит номер машины — всё за 10 секунд.' },
    { icon: <Smartphone size={28} />, title: 'Ждёт в машине', desc: 'Телефон показывает позицию в очереди и время ожидания. Когда подойдёт очередь — придёт уведомление прямо в браузере.' },
    { icon: <Users size={28} />, title: 'Оператор управляет', desc: 'Мойщик на планшете видит очередь, отмечает кто въехал в бокс и когда выехал. Никаких бумаг и криков.' },
  ];

  return (
    <section id="how" style={{ padding: '6rem 1.5rem', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
        <h2 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontFamily: 'var(--font-heading)', fontWeight: 800, marginBottom: '0.75rem' }}>
          Как это работает
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>Три шага — и очередь под контролем</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
        {steps.map((s, i) => (
          <div key={i} className="glass-panel" style={{ padding: '2rem', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '1.25rem', right: '1.25rem', fontSize: '3rem', fontWeight: 900, color: 'rgba(99,102,241,0.08)', fontFamily: 'var(--font-heading)' }}>{i + 1}</div>
            <div style={{ color: 'var(--accent-color)', marginBottom: '1rem' }}>{s.icon}</div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem' }}>{s.title}</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Benefits() {
  const items = [
    { icon: <TrendingUp size={22} />, title: 'Больше клиентов в день', desc: 'Электронная очередь сокращает простои между заездами. Боксы работают эффективнее — выручка растёт.' },
    { icon: <Clock size={22} />, title: 'Клиенты не уезжают', desc: 'Раньше видели очередь и разворачивались. Теперь записались и спокойно ждут в машине или кафе рядом.' },
    { icon: <BarChart2 size={22} />, title: 'Аналитика в реальном времени', desc: 'Сколько машин обслужили сегодня, среднее время мойки, часы пик — всё в одном дашборде.' },
    { icon: <QrCode size={22} />, title: 'Запуск за 5 минут', desc: 'Распечатайте QR-код, повесьте у въезда. Никакого оборудования, никаких приложений для клиента.' },
    { icon: <Smartphone size={22} />, title: 'Работает на любом телефоне', desc: 'Клиент открывает обычный браузер — никаких скачиваний. Оператор работает с планшета или телефона.' },
    { icon: <CheckCircle size={22} />, title: 'Подтверждение присутствия', desc: 'Система автоматически проверяет, что клиент на месте. Если не ответил — следующий в очереди.' },
    { icon: <MapPin size={22} />, title: 'Очередь прямо из 2ГИС и Яндекс Карт', desc: 'Добавьте ссылку на очередь в профиль мойки на 2ГИС, Яндекс Картах или Google Maps — клиент встаёт в очередь ещё по дороге, не теряя время у въезда.' },
  ];

  return (
    <section style={{ padding: '6rem 1.5rem', background: 'rgba(99,102,241,0.03)', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
          <h2 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontFamily: 'var(--font-heading)', fontWeight: 800, marginBottom: '0.75rem' }}>
            Выгода для владельца
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>Всё что нужно — уже внутри</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
          {items.map((item, i) => (
            <div key={i} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
              <div style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: '0.15rem' }}>{item.icon}</div>
              <div>
                <h4 style={{ fontSize: '0.975rem', fontWeight: 700, marginBottom: '0.35rem' }}>{item.title}</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', lineHeight: 1.6 }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA({ onEnter }) {
  return (
    <section style={{ padding: '6rem 1.5rem', textAlign: 'center' }}>
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        <div style={{ display: 'inline-flex', padding: '1rem', borderRadius: '30%', backgroundColor: 'rgba(99,102,241,0.1)', color: 'var(--accent-color)', marginBottom: '1.5rem', boxShadow: 'var(--glow-shadow)' }}>
          <Car size={36} />
        </div>
        <h2 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.5rem)', fontFamily: 'var(--font-heading)', fontWeight: 800, marginBottom: '1rem' }}>
          Готовы подключить вашу мойку?
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.6, marginBottom: '2rem' }}>
          Войдите в кабинет владельца, создайте профиль мойки и распечатайте QR-код. Первый клиент — через 5 минут.
        </p>
        <button className="btn btn-primary" style={{ padding: '0.875rem 2.5rem', fontSize: '1.0625rem', fontWeight: 700 }} onClick={onEnter}>
          Войти в кабинет <ArrowRight size={18} />
        </button>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '1rem' }}>
          Нужна своя база Supabase — бесплатный тариф подходит
        </p>
      </div>
    </section>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  const [config, setConfig] = useState(getSupabaseConfig());
  const [role, setRole] = useState('portal');
  const [businessId, setBusinessId] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get('role');
    const idParam = params.get('id');

    if (roleParam === 'client' && idParam) {
      setRole('client');
      setBusinessId(idParam);
    } else if (roleParam === 'operator' && idParam) {
      setRole('operator');
      setBusinessId(idParam);
    } else if (roleParam === 'owner') {
      setRole('owner');
    } else {
      setRole('portal');
    }
  }, []);

  const handleConfigSaved = () => setConfig(getSupabaseConfig());

  const handleResetConfig = () => {
    if (confirm('Вы уверены, что хотите сбросить настройки Supabase? Все локальные ключи будут удалены.')) {
      localStorage.removeItem('supabase_url');
      localStorage.removeItem('supabase_anon_key');
      setConfig({ supabaseUrl: '', supabaseAnonKey: '', isConfigured: false });
      setRole('portal');
      window.location.search = '';
    }
  };

  const goOwner = () => { window.location.search = '?role=owner'; };

  if (!config.isConfigured) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
        <SupabaseConfig onConfigSaved={handleConfigSaved} />
      </div>
    );
  }

  if (role === 'client') return <ClientPanel businessId={businessId} />;

  if (role === 'operator') {
    return (
      <>
        <div className="navbar">
          <div className="navbar-brand">🚗 CarWash Operator</div>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8125rem' }} onClick={() => window.location.search = ''}>В меню</button>
        </div>
        <OperatorPanel businessId={businessId} />
      </>
    );
  }

  if (role === 'owner') {
    return (
      <>
        <div className="navbar">
          <div className="navbar-brand">🚗 Кабинет Владельца</div>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8125rem' }} onClick={() => window.location.search = ''}>В меню</button>
        </div>
        <OwnerDashboard onLogout={() => setRole('portal')} />
      </>
    );
  }

  // ── LANDING PAGE ──
  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Navbar */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 2rem', backdropFilter: 'blur(12px)', background: 'rgba(10,10,20,0.75)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 800, fontSize: '1.05rem', fontFamily: 'var(--font-heading)' }}>
          <Car size={22} color="var(--accent-color)" /> SmartQueue
        </div>
        <button className="btn btn-primary" style={{ padding: '0.4rem 1.1rem', fontSize: '0.875rem' }} onClick={goOwner}>
          Войти в кабинет
        </button>
      </nav>

      {/* Spacer for fixed nav */}
      <div style={{ height: '64px' }} />

      <Hero onEnter={goOwner} />
      <HowItWorks />
      <Benefits />
      <CTA onEnter={goOwner} />

      {/* Footer */}
      <footer style={{ textAlign: 'center', padding: '2rem', borderTop: '1px solid var(--border-color)', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
        Разработано для развертывания на Vercel с базой данных Supabase.
      </footer>
    </div>
  );
}
