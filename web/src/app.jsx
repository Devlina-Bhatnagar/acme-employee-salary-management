/* global React, ReactDOM */
/* ACME HR client — JSX source, compiled to /app.js for a zero-build Docker deployment. */
const COUNTRY_NAMES = { US: 'United States', IN: 'India', GB: 'United Kingdom', DE: 'Germany', CA: 'Canada' };
const COUNTRY_CURRENCY = { US: 'USD', IN: 'INR', GB: 'GBP', DE: 'EUR', CA: 'CAD' };
const DEPARTMENTS = ['Engineering', 'Product', 'Sales', 'Marketing', 'Finance', 'People', 'Operations', 'Support'];
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const emptyEmployee = () => ({ employee_code: '', full_name: '', email: '', country: 'US', department: 'Engineering', job_title: '', currency: 'USD', annual_salary: '' });
const money = (minor, currency) => {
  if (minor == null) return '—';
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency, maximumFractionDigits: 0 }).format(minor / 100); }
  catch (_) { return `${currency} ${(minor / 100).toLocaleString()}`; }
};
const moneyExact = (minor, currency) => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100); }
  catch (_) { return `${currency} ${(minor / 100).toFixed(2)}`; }
};
const initials = name => (name || '?').split(' ').slice(0, 2).map(word => word[0]).join('').toUpperCase();
const errorMessage = detail => {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map(item => item.msg).join('; ');
  return 'Something went wrong. Please try again.';
};

class App extends React.Component {
  constructor(props) {
    super(props);
    const token = sessionStorage.getItem('acme_hr_token') || '';
    this.state = {
      token, authChecked: !token, user: null, loginEmail: '', loginPassword: '',
      tab: 'dashboard', busy: false, error: '', toast: '',
      report: null, employees: { items: [], total: 0, page: 1, pages: 0 },
      filterCountry: '', filterDepartment: '', search: '', status: 'active', sort: 'name', page: 1,
      selected: null, detailBusy: false, modal: '', addForm: emptyEmployee(), editForm: {},
      salaryForm: { annual_salary: '', effective_on: TODAY, reason: '' }, importFile: null, importStatus: '',
    };
    this.employeeLoadId = 0;
    this.searchDelay = null;
  }

  componentDidMount() {
    if (this.state.token) this.checkSession();
  }
  componentWillUnmount() { clearTimeout(this.searchDelay); }

  async api(path, opts = {}) {
    const headers = { ...(opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(opts.headers || {}) };
    if (this.state.token) headers.Authorization = `Bearer ${this.state.token}`;
    const response = await fetch(`/api${path}`, { ...opts, headers, cache: 'no-store' });
    if (!response.ok) {
      let detail = null;
      try { detail = (await response.json()).detail; } catch (_) { detail = null; }
      if (response.status === 401 && path !== '/auth/login') this.logout(true);
      throw new Error(errorMessage(detail) || `HTTP ${response.status}`);
    }
    if (opts.asBlob) return response.blob();
    return response.json();
  }

  async checkSession() {
    try {
      const user = await this.api('/auth/me');
      this.setState({ user, authChecked: true }, () => this.refreshAll());
    } catch (_) { this.logout(true); }
  }
  logout(expired = false) {
    sessionStorage.removeItem('acme_hr_token');
    this.setState({ token: '', user: null, authChecked: true, selected: null, error: expired ? 'Your session ended. Please sign in again.' : '', loginPassword: '' });
  }
  async login(e) {
    e.preventDefault();
    this.setState({ busy: true, error: '' });
    try {
      const result = await this.api('/auth/login', { method: 'POST', body: JSON.stringify({ email: this.state.loginEmail, password: this.state.loginPassword }) });
      sessionStorage.setItem('acme_hr_token', result.access_token);
      this.setState({ token: result.access_token, user: result.user, busy: false, loginPassword: '', authChecked: true }, () => this.refreshAll());
    } catch (err) { this.setState({ error: err.message, busy: false }); }
  }
  refreshAll() { this.loadReport(); this.loadEmployees(); }
  async loadReport() {
    try {
      const params = new URLSearchParams();
      if (this.state.filterCountry) params.set('country', this.state.filterCountry);
      if (this.state.filterDepartment) params.set('department', this.state.filterDepartment);
      const report = await this.api(`/reports/summary?${params}`);
      this.setState({ report });
    } catch (err) { this.setState({ error: err.message }); }
  }
  async loadEmployees() {
    const requestId = ++this.employeeLoadId;
    try {
      const params = new URLSearchParams({ page: String(this.state.page), page_size: '20', status: this.state.status, sort: this.state.sort });
      if (this.state.filterCountry) params.set('country', this.state.filterCountry);
      if (this.state.filterDepartment) params.set('department', this.state.filterDepartment);
      if (this.state.search.trim()) params.set('search', this.state.search.trim());
      const employees = await this.api(`/employees?${params}`);
      if (requestId === this.employeeLoadId) this.setState({ employees });
    } catch (err) { if (requestId === this.employeeLoadId) this.setState({ error: err.message }); }
  }
  filter(field, value, debounce = false) {
    this.setState({ [field]: value, page: 1 }, () => {
      if (field === 'filterCountry' || field === 'filterDepartment') this.loadReport();
      clearTimeout(this.searchDelay);
      this.searchDelay = setTimeout(() => this.loadEmployees(), debounce ? 250 : 0);
    });
  }
  changePage(page) { this.setState({ page }, () => this.loadEmployees()); }
  changeTab(tab) { this.setState({ tab, modal: '', selected: null, error: '' }); }
  notify(message) { this.setState({ toast: message, error: '' }); }
  async openEmployee(id) {
    this.setState({ detailBusy: true, modal: 'detail', selected: null, error: '' });
    try {
      const selected = await this.api(`/employees/${id}`);
      const editForm = { full_name: selected.full_name, email: selected.email, department: selected.department, job_title: selected.job_title, status: selected.status };
      this.setState({ selected, editForm, detailBusy: false, salaryForm: { annual_salary: (selected.current_salary_minor / 100).toFixed(2), effective_on: TODAY, reason: '' } });
    } catch (err) { this.setState({ modal: '', error: err.message, detailBusy: false }); }
  }
  async saveSalary(e) {
    e.preventDefault();
    const selected = this.state.selected;
    if (!selected) return;
    this.setState({ busy: true, error: '' });
    try {
      const detail = await this.api(`/employees/${selected.id}/salary`, { method: 'POST', body: JSON.stringify(this.state.salaryForm) });
      this.setState({ selected: detail, busy: false, modal: 'detail', salaryForm: { annual_salary: (detail.current_salary_minor / 100).toFixed(2), effective_on: TODAY, reason: '' } });
      this.notify('Salary updated and recorded in history.');
      this.refreshAll();
    } catch (err) { this.setState({ busy: false, error: err.message }); }
  }
  async saveProfile(e) {
    e.preventDefault();
    this.setState({ busy: true, error: '' });
    try {
      const selected = this.state.selected;
      await this.api(`/employees/${selected.id}`, { method: 'PATCH', body: JSON.stringify(this.state.editForm) });
      const detail = await this.api(`/employees/${selected.id}`);
      this.setState({ selected: detail, modal: 'detail', busy: false });
      this.notify('Employee profile updated.');
      this.refreshAll();
    } catch (err) { this.setState({ busy: false, error: err.message }); }
  }
  async deactivate() {
    if (!window.confirm('Mark this employee inactive? Salary history will be retained.')) return;
    this.setState({ editForm: { ...this.state.editForm, status: 'inactive' } }, async () => {
      try {
        const employee = this.state.selected;
        await this.api(`/employees/${employee.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'inactive' }) });
        const detail = await this.api(`/employees/${employee.id}`);
        this.setState({ selected: detail, modal: 'detail' });
        this.notify('Employee deactivated. History was preserved.');
        this.refreshAll();
      } catch (err) { this.setState({ error: err.message }); }
    });
  }
  async addEmployee(e) {
    e.preventDefault();
    this.setState({ busy: true, error: '' });
    try {
      const employee = await this.api('/employees', { method: 'POST', body: JSON.stringify(this.state.addForm) });
      this.setState({ busy: false, addForm: emptyEmployee(), modal: '' });
      this.notify(`Employee ${employee.employee_code} created.`);
      this.refreshAll();
      this.changeTab('employees');
    } catch (err) { this.setState({ busy: false, error: err.message }); }
  }
  async importCsv(e) {
    e.preventDefault();
    if (!this.state.importFile) return;
    const data = new FormData();
    data.append('file', this.state.importFile);
    this.setState({ busy: true, importStatus: '', error: '' });
    try {
      const result = await this.api('/employees/import', { method: 'POST', body: data });
      this.setState({ busy: false, importFile: null, importStatus: `${result.imported} employees successfully imported. All rows validated.` });
      this.notify('Import successful.');
      this.refreshAll();
    } catch (err) { this.setState({ busy: false, error: err.message }); }
  }
  async exportCsv() {
    this.setState({ busy: true, error: '' });
    try {
      const params = new URLSearchParams({ status: this.state.status });
      if (this.state.filterCountry) params.set('country', this.state.filterCountry);
      if (this.state.filterDepartment) params.set('department', this.state.filterDepartment);
      if (this.state.search.trim()) params.set('search', this.state.search.trim());
      const blob = await this.api(`/employees/export?${params}`, { asBlob: true });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'acme-employees.csv';
      document.body.appendChild(link);
      link.click(); link.remove(); URL.revokeObjectURL(url);
      this.setState({ busy: false });
      this.notify('Filtered employee CSV exported.');
    } catch (err) { this.setState({ busy: false, error: err.message }); }
  }
  renderLogin() {
    return <div className="login-screen">
      <div className="login-art"><div className="brand brand-light"><span className="brand-mark">A</span><span>acme<span className="brand-dot">.</span></span></div><div className="login-illustration"><div className="login-illustration-orb"></div><div className="illustration-card big"><span>Annual payroll clarity</span><strong>10,000 people</strong><div className="illustration-bars"><i></i><i></i><i></i><i></i><i></i><i></i></div></div><div className="illustration-card small">↗ &nbsp; Better decisions</div></div><h1>People first.<br />Pay with clarity.</h1><p>One secure workspace to understand and manage compensation across countries.</p><div className="login-foot">ACME HR Workspace • Internal use only</div></div>
      <div className="login-panel"><div className="login-box"><span className="eyebrow">WELCOME BACK</span><h2>Sign in to your workspace</h2><p>Manage employee salary data with confidence.</p>{this.state.error && <div className="alert danger" role="alert">{this.state.error}</div>}<form onSubmit={e => this.login(e)}><label>Email address<input aria-label="Email address" required type="email" autoComplete="username" value={this.state.loginEmail} onChange={e => this.setState({ loginEmail: e.target.value })} placeholder="hr@acme.example.invalid" /></label><label>Password<input aria-label="Password" required type="password" autoComplete="current-password" value={this.state.loginPassword} onChange={e => this.setState({ loginPassword: e.target.value })} placeholder="Enter your password" /></label><button className="button button-primary login-submit" disabled={this.state.busy}> {this.state.busy ? 'Signing in…' : 'Sign in →'} </button></form><div className="security-note">◈ &nbsp; Encrypted session • Authorized HR personnel only</div></div></div>
    </div>;
  }
  renderSidebar() {
    return <aside className="sidebar"><div className="brand"><span className="brand-mark">A</span><span>acme<span className="brand-dot">.</span></span></div><div className="workspace-label">HR WORKSPACE</div>
      <nav aria-label="Main navigation"><button className={`nav-item ${this.state.tab === 'dashboard' ? 'active' : ''}`} onClick={() => this.changeTab('dashboard')}><span>▦</span> Overview</button><button className={`nav-item ${this.state.tab === 'employees' ? 'active' : ''}`} onClick={() => this.changeTab('employees')}><span>♙</span> Employees</button><button className={`nav-item ${this.state.tab === 'import' ? 'active' : ''}`} onClick={() => this.changeTab('import')}><span>⇧</span> Import data</button></nav>
      <div className="side-bottom"><div className="side-tip"><span className="side-tip-icon">✦</span><strong>Built for clarity</strong><p>Compensation insights, always in the correct local currency.</p></div><div className="side-user"><span className="user-avatar">HR</span><div><strong>HR Administrator</strong><small>{this.state.user && this.state.user.email}</small></div><button title="Sign out" aria-label="Sign out" onClick={() => this.logout()}>↪</button></div></div>
    </aside>;
  }
  renderHeader() {
    const tabName = { dashboard: 'Overview', employees: 'Employees', import: 'Import data' }[this.state.tab];
    return <header className="topbar"><div className="breadcrumb">ACME <span>/</span> HR Workspace <span>/</span> <strong>{tabName}</strong></div><div className="header-right"><span className="secure-pill"><span className="status-dot"></span> Secure workspace</span><div className="avatar-small">HR</div></div></header>;
  }
  renderFilters(includeStatus = false) {
    return <div className="filters"><label className="select-label">Country<select aria-label="Country filter" value={this.state.filterCountry} onChange={e => this.filter('filterCountry', e.target.value)}><option value="">All countries</option>{Object.keys(COUNTRY_NAMES).map(code => <option key={code} value={code}>{COUNTRY_NAMES[code]}</option>)}</select></label><label className="select-label">Department<select aria-label="Department filter" value={this.state.filterDepartment} onChange={e => this.filter('filterDepartment', e.target.value)}><option value="">All departments</option>{DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}</select></label>{includeStatus && <label className="select-label">Status<select aria-label="Status filter" value={this.state.status} onChange={e => this.filter('status', e.target.value)}><option value="active">Active only</option><option value="inactive">Inactive only</option><option value="all">All employees</option></select></label>}</div>;
  }
  renderDashboard() {
    const report = this.state.report;
    return <div className="page"><div className="page-head"><div><span className="eyebrow">COMPENSATION INTELLIGENCE</span><h1>People &amp; pay, at a glance</h1><p>Accurate compensation insights for your global team.</p></div><button className="button button-primary" onClick={() => { this.setState({ modal: 'add', addForm: emptyEmployee() }); }}>+ Add employee</button></div>
      <div className="welcome-banner"><div><span className="welcome-eyebrow">YOUR ORGANIZATION</span><h2>Better decisions start<br />with clearer data.</h2><p>Explore pay trends across locations and teams — all in one place.</p></div><div className="banner-design"><div className="circles"></div><div className="banner-card"><span>GLOBAL WORKFORCE</span><strong>{(report && report.headcount || 0).toLocaleString()}</strong><small>Active employees</small></div></div></div>
      <div className="section-row"><div><h2>Compensation snapshot</h2><p>Annual base pay • Active employees only</p></div>{this.renderFilters()}</div>
      <div className="stats-grid"><div className="stat-card"><div className="stat-icon lilac">♙</div><div className="stat-label">Active headcount</div><strong>{report ? report.headcount.toLocaleString() : '—'}</strong><span className="stat-meta">Within selected filters</span></div><div className="stat-card"><div className="stat-icon blue">◎</div><div className="stat-label">Countries represented</div><strong>{report ? new Set(report.groups.map(item => item.country)).size : '—'}</strong><span className="stat-meta">Across your organization</span></div><div className="stat-card"><div className="stat-icon amber">▥</div><div className="stat-label">Departments</div><strong>{report ? new Set(report.groups.map(item => item.department)).size : '—'}</strong><span className="stat-meta">With active employees</span></div><div className="stat-card"><div className="stat-icon mint">◈</div><div className="stat-label">Currencies tracked</div><strong>{report ? report.currencies.length : '—'}</strong><span className="stat-meta">Reported separately</span></div></div>
      <div className="info-banner"><span className="info-symbol">i</span><div><strong>Currency-aware analytics</strong><p>Totals and averages are shown separately per currency to avoid misleading global comparisons.</p></div></div>
      <div className="dashboard-columns"><section className="panel"><div className="panel-title"><div><h3>Salary by currency</h3><p>Annual base salary for active employees</p></div><span className="panel-tag">LIVE DATA</span></div><div className="currency-list">{report && report.by_currency.length ? report.by_currency.map(row => <div className="currency-row" key={row.currency}><div className="currency-avatar">{row.currency.slice(0, 1)}</div><div className="currency-main"><strong>{row.currency} <small>• {row.headcount.toLocaleString()} people</small></strong><div className="currency-track"><span style={{ width: `${Math.max(4, row.headcount / report.headcount * 100)}%` }}></span></div></div><div className="currency-numbers"><strong>{money(row.total_salary_minor, row.currency)}</strong><small>Avg {money(row.average_salary_minor, row.currency)}</small></div></div>) : <div className="empty-state">No salary data matches these filters.</div>}</div></section>
      <section className="panel"><div className="panel-title"><div><h3>Pay distribution</h3><p>Salary bands in local currency</p></div></div>{report && report.salary_bands.length ? <div className="band-list">{report.currencies.map(currency => { const items = report.salary_bands.filter(b => b.currency === currency); const total = items.reduce((acc, b) => acc + b.headcount, 0); return <div className="band-group" key={currency}><div className="band-header"><strong>{currency}</strong><small>{total.toLocaleString()} employees</small></div><div className="band-track">{items.map((b, i) => <span key={b.band} className={`band-color c${i}`} style={{ width: `${total ? b.headcount / total * 100 : 0}%` }} title={`${b.band}: ${b.headcount}`} />)}</div></div>; })}<div className="legend"><span><i className="c0"></i> Under 50k</span><span><i className="c1"></i> 50–100k</span><span><i className="c2"></i> 100–200k</span><span><i className="c3"></i> 200k+</span></div></div> : <div className="empty-state">No matching employees.</div>}</section></div>
      <section className="panel breakdown"><div className="panel-title"><div><h3>Department &amp; country breakdown</h3><p>Answer compensation questions by location and team</p></div></div><div className="table-wrap"><table><thead><tr><th>COUNTRY</th><th>DEPARTMENT</th><th>EMPLOYEES</th><th>AVG ANNUAL BASE</th><th>TOTAL ANNUAL BASE</th></tr></thead><tbody>{report && report.groups.length ? report.groups.map((g, i) => <tr key={i}><td>{COUNTRY_NAMES[g.country] || g.country}</td><td>{g.department}</td><td>{g.headcount.toLocaleString()}</td><td className="money-cell">{money(g.average_salary_minor, g.currency)}</td><td className="money-cell">{money(g.total_salary_minor, g.currency)}</td></tr>) : <tr><td colSpan="5" className="empty-state">No records for the selected filters.</td></tr>}</tbody></table></div></section>
    </div>;
  }
  renderEmployees() {
    const data = this.state.employees;
    return <div className="page"><div className="page-head"><div><span className="eyebrow">EMPLOYEE DIRECTORY</span><h1>Your people, in one place</h1><p>Search, review, and update compensation records across your workforce.</p></div><div className="head-buttons"><button className="button button-outline" disabled={this.state.busy} onClick={() => this.exportCsv()}>⇩ Export CSV</button><button className="button button-primary" onClick={() => this.setState({ modal: 'add', addForm: emptyEmployee() })}>+ Add employee</button></div></div>
      <section className="panel directory-panel"><div className="dir-top"><div className="dir-heading"><h2>All employees <span className="count-pill">{data.total.toLocaleString()}</span></h2><p>Browse and manage salary information</p></div><div className="dir-search"><span>⌕</span><input aria-label="Search employees" value={this.state.search} onChange={e => this.filter('search', e.target.value, true)} placeholder="Search name, ID or email..." /></div></div>
      <div className="directory-filters">{this.renderFilters(true)}<label className="select-label">Sort by<select aria-label="Sort employees" value={this.state.sort} onChange={e => this.filter('sort', e.target.value)}><option value="name">Name A–Z</option><option value="salary_asc">Salary low–high</option><option value="salary_desc">Salary high–low</option><option value="updated">Recently updated</option></select></label></div>
      <div className="table-wrap"><table><thead><tr><th>EMPLOYEE</th><th>ID</th><th>COUNTRY</th><th>DEPARTMENT</th><th>ANNUAL BASE SALARY</th><th>STATUS</th><th></th></tr></thead><tbody>{data.items.length ? data.items.map(e => <tr key={e.id} className="clickable" onClick={() => this.openEmployee(e.id)}><td><div className="person-cell"><span className="person-avatar">{initials(e.full_name)}</span><div><strong>{e.full_name}</strong><small>{e.email}</small></div></div></td><td className="mono">{e.employee_code}</td><td>{COUNTRY_NAMES[e.country]}</td><td>{e.department}</td><td className="money-cell">{money(e.current_salary_minor, e.currency)}</td><td><span className={`status ${e.status}`}>{e.status}</span></td><td><button className="icon-button" aria-label={`View ${e.full_name}`} onClick={event => { event.stopPropagation(); this.openEmployee(e.id); }}>→</button></td></tr>) : <tr><td colSpan="7" className="empty-state">No employees match these filters.</td></tr>}</tbody></table></div>
      <div className="pagination"><span>Showing {data.total ? (data.page - 1) * data.page_size + 1 : 0}–{Math.min(data.page * data.page_size, data.total)} of {data.total.toLocaleString()} records</span><div><button disabled={data.page <= 1} onClick={() => this.changePage(data.page - 1)}>← Previous</button><span>Page {data.page} / {Math.max(1, data.pages)}</span><button disabled={data.page >= data.pages} onClick={() => this.changePage(data.page + 1)}>Next →</button></div></div>
      </section></div>;
  }
  renderImport() {
    return <div className="page"><div className="page-head"><div><span className="eyebrow">DATA MIGRATION</span><h1>Bring your data together</h1><p>Move from spreadsheets to a secure, searchable salary workspace.</p></div></div><div className="import-layout"><section className="panel upload-panel"><div className="upload-icon">⇧</div><h2>Import employee records</h2><p>Upload a CSV with your employee data. Every row is validated before any records are added.</p><form onSubmit={e => this.importCsv(e)}><label className="file-picker"><strong>{this.state.importFile ? this.state.importFile.name : 'Choose a CSV file'}</strong><span>CSV only • max 3 MB • up to 10,000 rows</span><input aria-label="Choose CSV file" type="file" required accept=".csv,text/csv" onChange={e => this.setState({ importFile: e.target.files[0] || null })} /></label><button className="button button-primary" disabled={!this.state.importFile || this.state.busy}>{this.state.busy ? 'Validating & importing…' : 'Import employees →'}</button></form>{this.state.importStatus && <div className="alert success" role="status">✓ {this.state.importStatus}</div>}</section><section className="panel tips-panel"><h3>Before you import</h3><div className="tips-item"><span>1</span><div><strong>Prepare your spreadsheet</strong><p>Use the exact columns listed in the template, including local annual base salary.</p></div></div><div className="tips-item"><span>2</span><div><strong>Validate your countries</strong><p>Supported in this demo: US/USD, India/INR, UK/GBP, Germany/EUR, Canada/CAD.</p></div></div><div className="tips-item"><span>3</span><div><strong>Prevent duplicates</strong><p>Employee ID and email must be unique. An invalid file imports no rows.</p></div></div><a className="button button-outline template-link" href="/import-template.csv" download="acme-import-template.csv">⇩ Download CSV template</a></section></div></div>;
  }
  textInput(label, value, onChange, props = {}) { return <label className="form-field">{label}<input value={value == null ? '' : value} onChange={onChange} {...props} /></label>; }
  renderModal() {
    const modal = this.state.modal;
    if (!modal) return null;
    const selected = this.state.selected;
    const addForm = this.state.addForm;
    const editForm = this.state.editForm;
    const salaryForm = this.state.salaryForm;
    return <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) this.setState({ modal: '' }); }}><div className="drawer" role="dialog" aria-modal="true" aria-label="Employee information"><div className="drawer-top"><div><span className="eyebrow">{modal === 'add' ? 'NEW TEAM MEMBER' : 'EMPLOYEE RECORD'}</span><h2>{modal === 'add' ? 'Add employee' : modal === 'salary' ? 'Update annual salary' : modal === 'edit' ? 'Edit profile' : 'Employee details'}</h2></div><button className="close-button" aria-label="Close dialog" onClick={() => this.setState({ modal: '' })}>×</button></div>
      <div className="drawer-body">{(modal === 'detail' && this.state.detailBusy) && <div className="empty-state">Loading employee…</div>}
      {modal === 'detail' && selected && <div><div className="drawer-person"><div className="drawer-avatar">{initials(selected.full_name)}</div><div><h3>{selected.full_name}</h3><p>{selected.job_title} · {selected.department}</p><span className={`status ${selected.status}`}>{selected.status}</span></div></div><div className="detail-grid"><div><small>EMPLOYEE ID</small><strong>{selected.employee_code}</strong></div><div><small>COUNTRY</small><strong>{COUNTRY_NAMES[selected.country]}</strong></div><div><small>EMAIL</small><strong className="break-word">{selected.email}</strong></div><div><small>DEPARTMENT</small><strong>{selected.department}</strong></div></div><div className="salary-highlight"><small>CURRENT ANNUAL BASE SALARY</small><strong>{moneyExact(selected.current_salary_minor, selected.currency)}</strong><span>Local currency • {selected.currency}</span></div><div className="drawer-actions"><button className="button button-primary" disabled={selected.status !== 'active'} onClick={() => this.setState({ modal: 'salary' })}>Update salary</button><button className="button button-outline" onClick={() => this.setState({ modal: 'edit' })}>Edit profile</button></div><div className="history-head"><h3>Salary history</h3><span>{selected.salary_history.length} events</span></div><div className="history-list">{selected.salary_history.map((revision, i) => <div className="history-item" key={revision.id}><div className="timeline-dot"></div><div><div className="history-line"><strong>{moneyExact(revision.new_salary_minor, revision.currency)}</strong><small>{revision.effective_on}</small></div><p>{revision.reason}</p><small>{revision.changed_by_email || 'System seed'} {revision.old_salary_minor != null ? `• From ${money(revision.old_salary_minor, revision.currency)}` : '• Initial salary'}</small></div></div>)}</div>{selected.status === 'active' && <button className="link-danger" onClick={() => this.deactivate()}>Deactivate employee</button>}</div>}
      {modal === 'salary' && selected && <form className="edit-form" onSubmit={e => this.saveSalary(e)}><div className="context-note">{selected.full_name} • {selected.currency} • Current: {moneyExact(selected.current_salary_minor, selected.currency)}</div>{this.textInput(`New annual base salary (${selected.currency})`, salaryForm.annual_salary, e => this.setState({ salaryForm: { ...salaryForm, annual_salary: e.target.value } }), { type: 'number', min: '0.01', max: '999999999.99', step: '0.01', required: true })}{this.textInput('Effective date', salaryForm.effective_on, e => this.setState({ salaryForm: { ...salaryForm, effective_on: e.target.value } }), { type: 'date', max: TODAY, required: true })}<label className="form-field">Reason for salary change<textarea minLength="5" maxLength="500" required rows="4" value={salaryForm.reason} placeholder="e.g. Annual compensation review" onChange={e => this.setState({ salaryForm: { ...salaryForm, reason: e.target.value } })} /></label><div className="form-note">This change is recorded permanently with the effective date and your HR account.</div><div className="drawer-actions"><button disabled={this.state.busy} className="button button-primary">{this.state.busy ? 'Saving…' : 'Save salary change'}</button><button type="button" className="button button-outline" onClick={() => this.setState({ modal: 'detail' })}>Cancel</button></div></form>}
      {modal === 'edit' && selected && <form className="edit-form" onSubmit={e => this.saveProfile(e)}>{this.textInput('Full name', editForm.full_name, e => this.setState({ editForm: { ...editForm, full_name: e.target.value } }), { required: true })}{this.textInput('Email address', editForm.email, e => this.setState({ editForm: { ...editForm, email: e.target.value } }), { required: true, type: 'email' })}<label className="form-field">Department<select value={editForm.department} onChange={e => this.setState({ editForm: { ...editForm, department: e.target.value } })}>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}</select></label>{this.textInput('Job title', editForm.job_title, e => this.setState({ editForm: { ...editForm, job_title: e.target.value } }), { required: true })}<label className="form-field">Status<select value={editForm.status} onChange={e => this.setState({ editForm: { ...editForm, status: e.target.value } })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label><div className="form-note">Country and currency are locked to preserve salary history consistency.</div><div className="drawer-actions"><button disabled={this.state.busy} className="button button-primary">{this.state.busy ? 'Saving…' : 'Save profile'}</button><button type="button" className="button button-outline" onClick={() => this.setState({ modal: 'detail' })}>Cancel</button></div></form>}
      {modal === 'add' && <form className="edit-form" onSubmit={e => this.addEmployee(e)}>{this.textInput('Employee ID', addForm.employee_code, e => this.setState({ addForm: { ...addForm, employee_code: e.target.value } }), { placeholder: 'e.g. ACME-X1020', required: true })}{this.textInput('Full name', addForm.full_name, e => this.setState({ addForm: { ...addForm, full_name: e.target.value } }), { placeholder: 'e.g. Avery Quinn', required: true })}{this.textInput('Work email', addForm.email, e => this.setState({ addForm: { ...addForm, email: e.target.value } }), { type: 'email', required: true })}<label className="form-field">Country<select value={addForm.country} onChange={e => this.setState({ addForm: { ...addForm, country: e.target.value, currency: COUNTRY_CURRENCY[e.target.value] } })}>{Object.keys(COUNTRY_NAMES).map(code => <option key={code} value={code}>{COUNTRY_NAMES[code]}</option>)}</select></label><label className="form-field">Department<select value={addForm.department} onChange={e => this.setState({ addForm: { ...addForm, department: e.target.value } })}>{DEPARTMENTS.map(d => <option key={d}>{d}</option>)}</select></label>{this.textInput('Job title', addForm.job_title, e => this.setState({ addForm: { ...addForm, job_title: e.target.value } }), { required: true, placeholder: 'e.g. Software Engineer' })}{this.textInput(`Annual base salary (${addForm.currency})`, addForm.annual_salary, e => this.setState({ addForm: { ...addForm, annual_salary: e.target.value } }), { type: 'number', min: '0.01', max: '999999999.99', step: '0.01', required: true })}<div className="form-note">Only fictitious employee data belongs in this assessment environment.</div><div className="drawer-actions"><button disabled={this.state.busy} className="button button-primary">{this.state.busy ? 'Saving…' : 'Create employee'}</button><button type="button" className="button button-outline" onClick={() => this.setState({ modal: '' })}>Cancel</button></div></form>}
      </div></div></div>;
  }
  render() {
    if (!this.state.authChecked) return <div className="boot">Checking secure session…</div>;
    if (!this.state.token) return this.renderLogin();
    return <div className="shell">{this.renderSidebar()}<main className="main">{this.renderHeader()}{this.state.error && <div className="alert danger global-error" role="alert">{this.state.error}<button onClick={() => this.setState({ error: '' })}>×</button></div>}{this.state.toast && <div className="toast" role="status">✓ &nbsp;{this.state.toast}<button onClick={() => this.setState({ toast: '' })}>×</button></div>}{this.state.tab === 'dashboard' && this.renderDashboard()}{this.state.tab === 'employees' && this.renderEmployees()}{this.state.tab === 'import' && this.renderImport()}</main>{this.renderModal()}</div>;
  }
}
ReactDOM.render(<App />, document.getElementById('app'));
