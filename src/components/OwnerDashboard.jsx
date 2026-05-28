// OwnerDashboard.jsx — что нужно изменить (3 места)

// ─────────────────────────────────────────────────────────
// 1. Добавить state рядом с busBaseTime (~строка 30):

const [busTimeout, setBusTimeout] = useState(180);

// ─────────────────────────────────────────────────────────
// 2. В loadBusiness() после setBusBaseTime добавить (~строка 82):

setBusTimeout(data[0].confirmation_timeout || 180);

// ─────────────────────────────────────────────────────────
// 3. В handleCreateBusiness — в insert добавить поле:

confirmation_timeout: busTimeout,

// ─────────────────────────────────────────────────────────
// 4. В handleSaveSettings — в update добавить поле:

confirmation_timeout: busTimeout,

// И обновить setBusiness:
setBusiness({ ...business, ..., confirmation_timeout: busTimeout });

// ─────────────────────────────────────────────────────────
// 5. В TAB: SETTINGS — добавить поле в форму рядом с busBaseTime:

<div>
  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
    Таймер подтверждения (секунд)
  </label>
  <input
    type="number"
    min="60"
    max="600"
    value={busTimeout}
    onChange={(e) => setBusTimeout(parseInt(e.target.value) || 180)}
  />
  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
    Сколько секунд клиент может подтвердить приезд (60–600 сек)
  </p>
</div>
