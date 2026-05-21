import React, { useState, useEffect, useRef } from 'react';
import { getSupabase } from '../supabase';
import QRCode from 'qrcode';
import { 
  Settings, BarChart2, QrCode, Clipboard, Check, 
  Download, Printer, LogOut, Info, RefreshCw, Car, Clock, UserX 
} from 'lucide-react';

export default function OwnerDashboard({ onLogout }) {
  const supabase = getSupabase();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // Auth Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Business State
  const [business, setBusiness] = useState(null);
  const [busName, setBusName] = useState('');
  const [busAddress, setBusAddress] = useState('');
  const [busBoxes, setBusBoxes] = useState(4);
  const [busBaseTime, setBusBaseTime] = useState(30);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Analytics State
  const [analyticsRange, setAnalyticsRange] = useState('today'); // 'today' | 'week'
  const [stats, setStats] = useState({
    totalServed: 0,
    avgWashTime: 0,
    dropOffs: 0
  });
  const [statsLoading, setStatsLoading] = useState(false);

  // Links & QR Code
  const qrCanvasRef = useRef(null);
  const [copiedLink, setCopiedLink] = useState('');
  const [activeTab, setActiveTab] = useState('analytics'); // 'analytics' | 'settings' | 'qr'

  // Manage Auth State
  useEffect(() => {
    if (!supabase) return;
    
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  // Load Business Config
  useEffect(() => {
    if (!session || !supabase) return;
    loadBusiness();
  }, [session]);

  // Generate QR Code when tab becomes active or business loads
  useEffect(() => {
    if (activeTab === 'qr' && business && qrCanvasRef.current) {
      const clientUrl = `${window.location.origin}${window.location.pathname}?role=client&id=${business.id}`;
      QRCode.toCanvas(
        qrCanvasRef.current,
        clientUrl,
        {
          width: 256,
          margin: 2,
          color: {
            dark: '#111827',
            light: '#FFFFFF',
          },
        },
        (error) => {
          if (error) console.error('Error generating QR code:', error);
        }
      );
    }
  }, [activeTab, business]);

  // Calculate Analytics when business changes or range changes
  useEffect(() => {
    if (!business || !supabase) return;
    fetchAnalytics();
  }, [business, analyticsRange]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        alert('Регистрация успешна! Проверьте email для подтверждения (если включено в Supabase) или войдите.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setAuthError(err.message || 'Ошибка авторизации');
    } finally {
      setAuthLoading(false);
    }
  };

  const loadBusiness = async () => {
    setLoading(true);
    try {
      // Find business owned by user
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .limit(1);

      if (error) throw error;

      if (data && data.length > 0) {
        setBusiness(data[0]);
        setBusName(data[0].name);
        setBusAddress(data[0].address || '');
        setBusBoxes(data[0].boxes_count);
        setBusBaseTime(data[0].base_wash_time);
      } else {
        setBusiness(null);
      }
    } catch (err) {
      console.error('Error loading business:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBusiness = async (e) => {
    e.preventDefault();
    if (!busName.trim()) return;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('businesses')
        .insert([{
          name: busName.trim(),
          address: busAddress.trim() || null,
          boxes_count: busBoxes,
          base_wash_time: busBaseTime
        }])
        .select();

      if (error) throw error;
      if (data && data.length > 0) {
        setBusiness(data[0]);
      }
    } catch (err) {
      alert('Ошибка при создании бизнеса: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    if (!business || !busName.trim()) return;
    setSavingSettings(true);
    setSaveSuccess(false);

    try {
      const { error } = await supabase
        .from('businesses')
        .update({
          name: busName.trim(),
          address: busAddress.trim() || null,
          boxes_count: busBoxes,
          base_wash_time: busBaseTime
        })
        .eq('id', business.id);

      if (error) throw error;
      setBusiness({
        ...business,
        name: busName.trim(),
        address: busAddress.trim() || null,
        boxes_count: busBoxes,
        base_wash_time: busBaseTime
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      alert('Ошибка сохранения: ' + err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const fetchAnalytics = async () => {
    setStatsLoading(true);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      weekAgo.setHours(0, 0, 0, 0);

      const targetDate = analyticsRange === 'today' ? today.toISOString() : weekAgo.toISOString();

      // Fetch completed and cancelled queue rows in target range
      const { data, error } = await supabase
        .from('queue')
        .select('*')
        .eq('business_id', business.id)
        .gte('joined_at', targetDate);

      if (error) throw error;

      const completed = data.filter(item => item.status === 'completed');
      const cancelled = data.filter(item => item.status === 'cancelled');

      // Calculate total served
      const totalServed = completed.length;

      // Calculate average real washing time (started_at to completed_at)
      let avgWashTime = 0;
      if (completed.length > 0) {
        const durations = completed
          .filter(item => item.started_at && item.completed_at)
          .map(item => {
            const start = new Date(item.started_at);
            const end = new Date(item.completed_at);
            return (end - start) / 60000; // in minutes
          });
        
        if (durations.length > 0) {
          const sum = durations.reduce((acc, curr) => acc + curr, 0);
          avgWashTime = Math.round(sum / durations.length);
        }
      }

      // Calculate drop-offs
      const dropOffs = cancelled.length;

      setStats({
        totalServed,
        avgWashTime: avgWashTime || 0,
        dropOffs
      });
    } catch (err) {
      console.error('Error fetching analytics:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(type);
    setTimeout(() => setCopiedLink(''), 2000);
  };

  const handleDownloadQR = () => {
    if (!qrCanvasRef.current) return;
    const url = qrCanvasRef.current.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-code-${business.name.replace(/\s+/g, '-').toLowerCase()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    if (onLogout) onLogout();
  };

  if (!supabase) {
    return <div className="glass-panel" style={{ margin: '2rem', textAlign: 'center' }}>Подключение Supabase не настроено.</div>;
  }

  if (loading && session) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <RefreshCw className="pulse-primary" size={40} style={{ animation: 'spin 1.5s linear infinite' }} />
      </div>
    );
  }

  // AUTH SCREEN
  if (!session) {
    return (
      <div className="config-container glass-panel animate-slide-up">
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div className="pulse-primary" style={{
            display: 'inline-flex',
            padding: '1rem',
            borderRadius: '50%',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            color: 'var(--accent-color)',
            marginBottom: '1rem'
          }}>
            <Settings size={40} />
          </div>
          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Кабинет владельца</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Войдите или зарегистрируйтесь для управления автомойкой</p>
        </div>

        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Email
            </label>
            <input
              type="email"
              required
              placeholder="owner@wash.ru"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Пароль
            </label>
            <input
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {authError && (
            <div style={{ color: 'var(--color-danger)', fontSize: '0.875rem' }}>
              ⚠️ {authError}
            </div>
          )}

          <button type="submit" className="btn btn-primary btn-block" disabled={authLoading}>
            {authLoading ? 'Загрузка...' : isSignUp ? 'Создать аккаунт' : 'Войти в кабинет'}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem' }}>
          <button 
            onClick={() => setIsSignUp(!isSignUp)} 
            style={{ background: 'none', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', fontWeight: 500 }}
          >
            {isSignUp ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
          </button>
        </div>
      </div>
    );
  }

  // CREATE BUSINESS SCREEN (IF FIRST LOGGED IN AND NO BUSINESS EXISTS)
  if (!business) {
    return (
      <div className="config-container glass-panel animate-slide-up">
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Создать автомойку</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Укажите стартовые настройки для запуска очереди</p>
        </div>

        <form onSubmit={handleCreateBusiness} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Название автомойки *
            </label>
            <input
              type="text"
              required
              placeholder="Например, Чистый Стриж"
              value={busName}
              onChange={(e) => setBusName(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Адрес
            </label>
            <input
              type="text"
              placeholder="ул. Ленина, д. 42"
              value={busAddress}
              onChange={(e) => setBusAddress(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Количество боксов
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={busBoxes}
                onChange={(e) => setBusBoxes(parseInt(e.target.value) || 1)}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Время мойки (мин)
              </label>
              <input
                type="number"
                min="5"
                max="180"
                value={busBaseTime}
                onChange={(e) => setBusBaseTime(parseInt(e.target.value) || 30)}
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: '0.5rem' }}>
            Создать бизнес
          </button>
        </form>
      </div>
    );
  }

  const clientUrl = `${window.location.origin}${window.location.pathname}?role=client&id=${business.id}`;
  const operatorUrl = `${window.location.origin}${window.location.pathname}?role=operator&id=${business.id}`;

  // MAIN OWNER PANEL DASHBOARD
  return (
    <div className="container animate-slide-up">
      {/* Hidden Print Layout */}
      <div className="print-layout" style={{ display: 'none' }}>
        <div className="print-header">
          <h1 className="print-title">{business.name}</h1>
          <p className="print-address">{business.address || 'Онлайн-очередь'}</p>
        </div>
        <div className="print-qr-container">
          <canvas ref={qrCanvasRef}></canvas>
        </div>
        <div className="print-instructions">
          <p>🚗 Сканируйте QR-код, чтобы занять очередь</p>
          <p style={{ fontSize: '12pt', fontWeight: 'normal', marginTop: '3mm', color: '#6b7280' }}>
            Вам не нужно устанавливать приложения или Telegram. Отслеживайте статус прямо в браузере.
          </p>
        </div>
        <div className="print-footer">
          Быстрая очередь от CarWash Queue Manager
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2.25rem', fontFamily: 'var(--font-heading)' }}>{business.name}</h1>
          <p style={{ color: 'var(--text-secondary)' }}>{business.address || 'Адрес не указан'}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={handleSignOut}>
            <LogOut size={16} /> Выйти
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <button 
          className={`btn ${activeTab === 'analytics' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('analytics')}
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
        >
          <BarChart2 size={16} /> Аналитика
        </button>
        <button 
          className={`btn ${activeTab === 'settings' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('settings')}
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
        >
          <Settings size={16} /> Настройки бизнеса
        </button>
        <button 
          className={`btn ${activeTab === 'qr' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('qr')}
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
        >
          <QrCode size={16} /> QR-код и ссылки
        </button>
      </div>

      {/* TAB: ANALYTICS */}
      {activeTab === 'analytics' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.5rem' }}>Дашборд контроля</h2>
            <div style={{ display: 'flex', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '0.25rem', border: '1px solid var(--border-color)' }}>
              <button 
                onClick={() => setAnalyticsRange('today')}
                style={{
                  background: analyticsRange === 'today' ? 'var(--accent-color)' : 'none',
                  border: 'none', color: 'white', cursor: 'pointer', padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8125rem', fontWeight: 500
                }}
              >
                Сегодня
              </button>
              <button 
                onClick={() => setAnalyticsRange('week')}
                style={{
                  background: analyticsRange === 'week' ? 'var(--accent-color)' : 'none',
                  border: 'none', color: 'white', cursor: 'pointer', padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8125rem', fontWeight: 500
                }}
              >
                Неделя
              </button>
            </div>
          </div>

          <div className="analytics-grid">
            <div className="glass-panel analytics-card">
              <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-success)', marginBottom: '0.5rem' }}>
                <Car size={24} />
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Обслужено машин</p>
              {statsLoading ? (
                <div className="analytics-value">...</div>
              ) : (
                <div className="analytics-value" style={{ color: 'var(--color-success)' }}>{stats.totalServed}</div>
              )}
            </div>

            <div className="glass-panel analytics-card">
              <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-info)', marginBottom: '0.5rem' }}>
                <Clock size={24} />
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Среднее время мойки</p>
              {statsLoading ? (
                <div className="analytics-value">...</div>
              ) : (
                <div className="analytics-value" style={{ color: 'var(--color-info)' }}>{stats.avgWashTime} мин</div>
              )}
            </div>

            <div className="glass-panel analytics-card">
              <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--color-danger)', marginBottom: '0.5rem' }}>
                <UserX size={24} />
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Количество отвалов</p>
              {statsLoading ? (
                <div className="analytics-value">...</div>
              ) : (
                <div className="analytics-value" style={{ color: 'var(--color-danger)' }}>{stats.dropOffs}</div>
              )}
            </div>
          </div>

          <div className="glass-panel" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
            <Info style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: '2px' }} size={20} />
            <div>
              <h4 style={{ marginBottom: '0.25rem' }}>Как рассчитываются метрики?</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: '1.4' }}>
                Показатели рассчитываются автоматически в реальном времени. Среднее время вычисляется по кликам
                оператора «Мойка завершена» (разница во времени между заездом машины в бокс и окончанием обслуживания).
                «Отвалы» учитывают клиентов, покинувших очередь кнопкой «Покинуть очередь» или автоматически удаленных за неподтверждение присутствия.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB: SETTINGS */}
      {activeTab === 'settings' && (
        <div className="glass-panel" style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Параметры автомойки</h2>
          
          <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Название автомойки
              </label>
              <input
                type="text"
                required
                value={busName}
                onChange={(e) => setBusName(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Адрес
              </label>
              <input
                type="text"
                value={busAddress}
                onChange={(e) => setBusAddress(e.target.value)}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Количество рабочих боксов
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={busBoxes}
                  onChange={(e) => setBusBoxes(parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Базовое время мойки (минут)
                </label>
                <input
                  type="number"
                  min="5"
                  max="180"
                  value={busBaseTime}
                  onChange={(e) => setBusBaseTime(parseInt(e.target.value) || 30)}
                />
              </div>
            </div>

            {saveSuccess && (
              <div style={{ color: 'var(--color-success)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Check size={16} /> Изменения сохранены!
              </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={savingSettings} style={{ alignSelf: 'flex-start' }}>
              {savingSettings ? 'Сохранение...' : 'Сохранить изменения'}
            </button>
          </form>
        </div>
      )}

      {/* TAB: QR GENERATOR & LINKS */}
      {activeTab === 'qr' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem' }}>
          <div className="glass-panel">
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Ссылки для интеграции</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              Скопируйте эти ссылки для добавления на ваши карты (2GIS, Яндекс, Google), Instagram или распечатайте QR-код.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <h4 style={{ fontSize: '0.9375rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Панель клиента (QR-код)</h4>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Эту ссылку сканируют клиенты при въезде на мойку</p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="text" readOnly value={clientUrl} style={{ fontSize: '0.875rem' }} />
                  <button className="btn btn-secondary" onClick={() => copyToClipboard(clientUrl, 'client')}>
                    {copiedLink === 'client' ? <Check size={16} style={{ color: 'var(--color-success)' }} /> : <Clipboard size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <h4 style={{ fontSize: '0.9375rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Панель оператора (Планшет / Ноутбук)</h4>
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Эту ссылку откроет администратор/мойщик на своем устройстве</p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input type="text" readOnly value={operatorUrl} style={{ fontSize: '0.875rem' }} />
                  <button className="btn btn-secondary" onClick={() => copyToClipboard(operatorUrl, 'operator')}>
                    {copiedLink === 'operator' ? <Check size={16} style={{ color: 'var(--color-success)' }} /> : <Clipboard size={16} />}
                  </button>
                </div>
                <div style={{ marginTop: '0.5rem' }}>
                  <a href={operatorUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '0.4rem 1rem', fontSize: '0.8125rem' }}>
                    Открыть панель оператора ↗
                  </a>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>QR-код для печати</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Поместите у въезда или на стойке администрации</p>
            
            <div className="qr-preview-container">
              <canvas ref={qrCanvasRef}></canvas>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', width: '100%', maxWidth: '320px' }}>
              <button className="btn btn-primary" style={{ flex: 1, padding: '0.75rem' }} onClick={handleDownloadQR}>
                <Download size={16} /> Скачать PNG
              </button>
              <button className="btn btn-secondary" style={{ flex: 1, padding: '0.75rem' }} onClick={handlePrint}>
                <Printer size={16} /> Печать А4 (PDF)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
