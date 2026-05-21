import React, { useState } from 'react';
import { saveSupabaseConfig, getSupabaseConfig } from '../supabase';
import { Database, Key, Save, HelpCircle, CheckCircle } from 'lucide-react';

export default function SupabaseConfig({ onConfigSaved }) {
  const currentConfig = getSupabaseConfig();
  const [url, setUrl] = useState(currentConfig.supabaseUrl);
  const [key, setKey] = useState(currentConfig.supabaseAnonKey);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!url.trim() || !key.trim()) {
      setError('Пожалуйста, заполните оба поля');
      return;
    }

    try {
      // Validate basic format
      new URL(url);
      saveSupabaseConfig(url.trim(), key.trim());
      setSaved(true);
      setError('');
      setTimeout(() => {
        setSaved(false);
        if (onConfigSaved) onConfigSaved();
      }, 1500);
    } catch (err) {
      setError('Некорректный формат Supabase URL (должен быть в виде https://xxxx.supabase.co)');
    }
  };

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
          <Database size={40} />
        </div>
        <h2 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Подключение к Supabase</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Для работы системы MVP необходима база данных. Настройте подключение ниже.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Supabase Project URL
          </label>
          <div style={{ position: 'relative' }}>
            <Database size={18} style={{ position: 'absolute', left: '12px', top: '16px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="https://your-project.supabase.co"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{ paddingLeft: '2.5rem' }}
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Supabase Anon Public API Key
          </label>
          <div style={{ position: 'relative' }}>
            <Key size={18} style={{ position: 'absolute', left: '12px', top: '16px', color: 'var(--text-muted)' }} />
            <input
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              style={{ paddingLeft: '2.5rem' }}
            />
          </div>
        </div>

        {error && (
          <div style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
            ⚠️ {error}
          </div>
        )}

        {saved && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            color: 'var(--color-success)',
            fontSize: '0.9375rem',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            padding: '0.75rem',
            borderRadius: 'var(--radius-md)'
          }}>
            <CheckCircle size={18} /> Настройки сохранены! Перезагрузка...
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-block" style={{ marginTop: '0.5rem' }}>
          <Save size={18} /> Сохранить настройки
        </button>
      </form>

      <div style={{
        marginTop: '2rem',
        paddingTop: '1.5rem',
        borderTop: '1px solid var(--border-color)',
        fontSize: '0.8125rem',
        color: 'var(--text-muted)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem'
      }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <HelpCircle size={16} style={{ flexShrink: 0, color: 'var(--accent-color)' }} />
          <div>
            <strong>Как это работает?</strong> Данные сохраняются локально в вашем браузере (localStorage) и не передаются третьим лицам. Вы можете в любой момент переопределить их через файл <code>.env</code> при развертывании в GitHub / Vercel.
          </div>
        </div>
        <div>
          <strong>Таблицы базы данных:</strong> Не забудьте выполнить SQL-скрипт из файла <code>supabase_schema.sql</code> в SQL Editor вашей панели Supabase для создания необходимых таблиц.
        </div>
      </div>
    </div>
  );
}
