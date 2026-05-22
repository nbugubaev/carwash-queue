import React, { useState, useEffect } from 'react';
import { getSupabaseConfig, getSupabase } from './supabase';
import SupabaseConfig from './components/SupabaseConfig';
import OwnerDashboard from './components/OwnerDashboard';
import OperatorPanel from './components/OperatorPanel';
import ClientPanel from './components/ClientPanel';
import { Car, Shield, Users, Database, ArrowRight } from 'lucide-react';

export default function App() {
  const [config, setConfig] = useState(getSupabaseConfig());
  const [role, setRole] = useState('portal'); // 'portal' | 'owner' | 'operator' | 'client'
  const [businessId, setBusinessId] = useState(null);

  // Read URL query parameters for routing
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

  const handleConfigSaved = () => {
    setConfig(getSupabaseConfig());
  };

  const handleResetConfig = () => {
    if (confirm('Вы уверены, что хотите сбросить настройки Supabase? Все локальные ключи будут удалены.')) {
      localStorage.removeItem('supabase_url');
      localStorage.removeItem('supabase_anon_key');
      setConfig({ supabaseUrl: '', supabaseAnonKey: '', isConfigured: false });
      setRole('portal');
      window.location.search = ''; // clear query params
    }
  };

  // If Supabase credentials are not set, force config screen
  if (!config.isConfigured) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
        <SupabaseConfig onConfigSaved={handleConfigSaved} />
      </div>
    );
  }

  // Route to the appropriate panel based on URL parameter role
  if (role === 'client') {
    return <ClientPanel businessId={businessId} />;
  }

  if (role === 'operator') {
    return (
      <>
        <div className="navbar">
          <div className="navbar-brand">
            🚗 CarWash Operator
          </div>
          <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8125rem' }} onClick={() => window.location.search = ''}>
            В меню
          </button>
        </div>
        <OperatorPanel businessId={businessId} />
      </>
    );
  }

  if (role === 'owner') {
    return (
      <>
        <div className="navbar">
          <div className="navbar-brand">
            🚗 Кабинет Владельца
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8125rem' }} onClick={() => window.location.search = ''}>
              В меню
            </button>
          </div>
        </div>
        <OwnerDashboard onLogout={() => setRole('portal')} />
      </>
    );
  }

  // PORTAL SELECTOR (LANDING PAGE)
  return (
    <div className="container animate-slide-up" style={{ maxWidth: '800px', padding: '4rem 1.5rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
        <div style={{
          display: 'inline-flex',
          padding: '1.25rem',
          borderRadius: '30%',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          color: 'var(--accent-color)',
          marginBottom: '1.25rem',
          boxShadow: 'var(--glow-shadow)'
        }}>
          <Car size={48} />
        </div>
        <h1 style={{ fontSize: '3rem', fontFamily: 'var(--font-heading)', fontWeight: 800, marginBottom: '0.75rem' }}>
          Smart CarWash Queue
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem', maxWidth: '500px', margin: '0 auto', lineHeight: '1.5' }}>
          Система живой очереди автомойки в реальном времени. Настройка бизнеса, панели клиентов и оператора.
        </p>
      </div>

      <div className="grid-cols-2" style={{ marginBottom: '3rem' }}>
        {/* Card 1: Owner Panel */}
        <div className="glass-panel" style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'space-between', 
          padding: '2rem',
          border: '1px solid rgba(255,255,255,0.05)'
        }}>
          <div>
            <div style={{ color: 'var(--accent-color)', marginBottom: '1rem' }}>
              <Shield size={32} />
            </div>
            <h3 style={{ fontSize: '1.35rem', marginBottom: '0.5rem' }}>Владелец автомойки</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: '1.5', marginBottom: '1.5rem' }}>
              Быстрая настройка адреса, боксов, тарифов времени. Генерация распечаток QR-кодов, LIVE-аналитика за сегодня и неделю.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => window.location.search = '?role=owner'}>
            Войти в кабинет <ArrowRight size={16} />
          </button>
        </div>

        {/* Card 2: Demo Database Admin */}
        <div className="glass-panel" style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'space-between', 
          padding: '2rem',
          border: '1px solid rgba(255,255,255,0.05)'
        }}>
          <div>
            <div style={{ color: 'var(--color-info)', marginBottom: '1rem' }}>
              <Database size={32} />
            </div>
            <h3 style={{ fontSize: '1.35rem', marginBottom: '0.5rem' }}>Настройки подключения</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: '1.5', marginBottom: '1.5rem' }}>
              Ваша база данных Supabase подключена. Вы можете просмотреть или изменить параметры API подключения в любой момент.
            </p>
          </div>
          <button className="btn btn-secondary" onClick={handleResetConfig}>
            Изменить ключи Supabase
          </button>
        </div>
      </div>

      <div style={{
        textAlign: 'center',
        paddingTop: '2rem',
        borderTop: '1px solid var(--border-color)',
        fontSize: '0.8125rem',
        color: 'var(--text-muted)'
      }}>
        Разработано для развертывания на Vercel с базой данных Supabase.
      </div>
    </div>
  );
}
