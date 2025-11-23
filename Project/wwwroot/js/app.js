class CamerasCRM {
    constructor() {
        this.currentUser = null;
        this.hubConnection = null;
        this.cameras = [];
        this.logs = [];
        this.notifications = [];
        this.notificationFilter = 'all';
        this.chart = null;
        this.logStats = { totalLogs: 0, errors: 0, warnings: 0, info: 0 };
        this.currentPage = 1;
        this.logsPerPage = 50;
        this.totalLogsCount = 0;
        this.token = localStorage.getItem('token');
        this.streamApiUrl = localStorage.getItem('streamApiUrl') || 'http://185.31.165.14:8080';
        this.streamToken = localStorage.getItem('streamToken') || 'cam_secret_2024';
        this.pendingDeleteId = null;
        this.renderDebounce = null;
        this.statsDebounce = null;
        this.isInitialLoad = true;
        this.currentTheme = localStorage.getItem('theme') || 'dark';
        this.datepickers = [];
        this.selectedLogLevel = '';
        this.isPageVisible = true;
        this.logsBatch = [];
        this.batchTimeout = null;
        this.chartDataReady = false;

        // Cached DOM elements
        this.dom = {};
    }

    // Build filter params for API calls
    buildFilterParams(includePagination = false) {
        const params = new URLSearchParams();

        if (this.selectedLogLevel) {
            params.append('level', this.selectedLogLevel);
        }

        const dateFrom = this.dom.logDateFrom?.value;
        const dateTo = this.dom.logDateTo?.value;

        if (dateFrom) params.append('from', dateFrom);
        if (dateTo) params.append('to', dateTo);

        if (includePagination) {
            params.append('page', this.currentPage);
            params.append('pageSize', this.logsPerPage);
        }

        return params;
    }

    init() {
        this.cacheDOM();
        this.initTheme();
        this.initEventListeners();

        if (this.token && localStorage.getItem('user')) {
            this.currentUser = JSON.parse(localStorage.getItem('user'));
            if (this.dom.currentUsername) {
                this.dom.currentUsername.textContent = this.currentUser.username;
            }
            this.showScreen('dashboard');
            this.loadAllDataParallel();
        } else {
            this.hideGlobalLoader();
            this.showScreen('login');
        }
    }

    cacheDOM() {
        const ids = [
            'globalLoader', 'loginScreen', 'dashboard', 'currentUsername',
            'loginBtn', 'loginPassword', 'loginUsername', 'loginError',
            'logoutBtn', 'logoBtn', 'addCameraBtn', 'saveCameraBtn',
            'closeModal', 'cameraModal', 'applyFiltersBtn', 'markAllReadBtn',
            'filterAllBtn', 'filterUnreadBtn', 'prevPage', 'nextPage',
            'logsPerPage', 'confirmCancel', 'confirmOk', 'confirmModal',
            'deleteCancel', 'deleteOk', 'deleteModal', 'themeToggle',
            'camerasList', 'logsTableBody', 'notificationsList',
            'logDateFrom', 'logDateTo', 'logLevelFilterWrapper',
            'signalrStatus', 'notificationBadge', 'notificationsCount',
            'paginationInfo', 'pageNumbers', 'logsChart',
            'totalLogs', 'errorLogs', 'warningLogs', 'infoLogs',
            'cameraName', 'cameraLocation', 'cameraRtspUrl'
        ];
        ids.forEach(id => this.dom[id] = document.getElementById(id));
    }

    async loadAllDataParallel() {
        try {
            this.connectSignalR();

            const results = await Promise.allSettled([
                this.loadCameras(),
                this.loadLogs(),
                this.loadNotifications()
            ]);

            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    console.error(`Ошибка загрузки ${['камеры', 'логи', 'уведомления'][index]}:`, result.reason);
                }
            });

            this.initDatePickers();
            this.initCustomSelect();
            this.chartDataReady = true;
        } catch (error) {
            console.error('Критическая ошибка загрузки данных:', error);
            this.showToast('Ошибка', 'Не удалось загрузить данные');
        } finally {
            // Wait for chart to be rendered before hiding loader
            requestAnimationFrame(() => {
                setTimeout(() => {
                    this.hideGlobalLoader();
                    this.isInitialLoad = false;
                }, 100);
            });
        }
    }

    // Clear all filters and reload
    clearFilters() {
        this.selectedLogLevel = '';
        this.currentPage = 1;

        // Reset UI
        if (this.dom.logDateFrom) this.dom.logDateFrom.value = '';
        if (this.dom.logDateTo) this.dom.logDateTo.value = '';

        // Reset custom select
        const wrapper = this.dom.logLevelFilterWrapper;
        if (wrapper) {
            const trigger = wrapper.querySelector('.custom-select-trigger span');
            if (trigger) trigger.textContent = 'Все уровни';
            wrapper.querySelectorAll('.custom-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === '');
            });
        }

        // Clear datepickers
        this.datepickers.forEach(dp => dp.clear && dp.clear());

        this.loadLogs();
    }

    // Get current filter description for display
    getFilterDescription() {
        const parts = [];
        if (this.selectedLogLevel) {
            parts.push(`Уровень: ${this.selectedLogLevel}`);
        }
        if (this.dom.logDateFrom?.value) {
            parts.push(`С: ${this.dom.logDateFrom.value}`);
        }
        if (this.dom.logDateTo?.value) {
            parts.push(`По: ${this.dom.logDateTo.value}`);
        }
        return parts.length ? parts.join(', ') : 'Все логи';
    }

    hideGlobalLoader() {
        this.dom.globalLoader?.classList.add('hidden');
    }

    initTheme() {
        document.documentElement.setAttribute('data-theme', this.currentTheme);
    }

    toggleTheme() {
        this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', this.currentTheme);
        localStorage.setItem('theme', this.currentTheme);
        this.chart && this.updateChartTheme();
    }

    initDatePickers() {
        if (typeof AirDatepicker === 'undefined') return;

        const locale = {
            days: ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'],
            daysShort: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
            daysMin: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
            months: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
            monthsShort: ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'],
            today: 'Сегодня',
            clear: 'Очистить',
            dateFormat: 'yyyy-MM-dd',
            timeFormat: 'HH:mm',
            firstDay: 1
        };

        const config = {
            locale,
            dateFormat: 'yyyy-MM-dd',
            position: 'bottom left',
            autoClose: true,
            toggleSelected: false,
            buttons: ['today', 'clear']
        };

        [this.dom.logDateFrom, this.dom.logDateTo].forEach(el => {
            if (el) this.datepickers.push(new AirDatepicker(el, config));
        });
    }

    initCustomSelect() {
        const wrapper = this.dom.logLevelFilterWrapper;
        if (!wrapper) return;

        const trigger = wrapper.querySelector('.custom-select-trigger');
        const options = wrapper.querySelectorAll('.custom-option');
        if (!trigger || !options.length) return;

        trigger.addEventListener('click', e => {
            e.stopPropagation();
            wrapper.classList.toggle('active');
        });

        options.forEach(option => {
            option.addEventListener('click', e => {
                e.stopPropagation();
                options.forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');
                const triggerText = trigger.querySelector('span');
                if (triggerText) {
                    triggerText.textContent = option.querySelector('span')?.textContent || 'Все уровни';
                }
                this.selectedLogLevel = option.dataset.value || '';
                wrapper.classList.remove('active');

                // Auto-apply filter and reload with new chart
                this.currentPage = 1;
                this.loadLogs();
            });
        });

        document.addEventListener('click', e => {
            if (!wrapper.contains(e.target)) wrapper.classList.remove('active');
        });
    }

    updateChartTheme() {
        if (!this.chart?.options) return;

        const isDark = this.currentTheme === 'dark';
        const textColor = isDark ? '#c9d1d9' : '#1f2328';
        const mutedColor = isDark ? '#8b949e' : '#57606a';
        const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
        const gridColorLight = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';

        const { options } = this.chart;
        options.plugins.legend.labels.color = textColor;
        options.scales.y.ticks.color = mutedColor;
        options.scales.x.ticks.color = mutedColor;
        options.scales.y.grid.color = gridColor;
        options.scales.x.grid.color = gridColorLight;
        this.chart.update('none');
    }

    showScreen(screen) {
        this.dom.loginScreen?.classList.remove('show');
        this.dom.dashboard?.classList.remove('show');
        (screen === 'dashboard' ? this.dom.dashboard : this.dom.loginScreen)?.classList.add('show');
    }

    getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.token) headers.Authorization = `Bearer ${this.token}`;
        return headers;
    }

    clearAuth() {
        this.token = null;
        this.currentUser = null;
        localStorage.removeItem('token');
        localStorage.removeItem('user');
    }

    initEventListeners() {
        const on = (el, event, handler) => el?.addEventListener(event, handler);

        on(this.dom.loginBtn, 'click', () => this.login());
        on(this.dom.loginPassword, 'keypress', e => e.key === 'Enter' && this.login());
        on(this.dom.logoutBtn, 'click', () => this.showLogoutConfirm());
        on(this.dom.logoBtn, 'click', () => this.switchTab('cameras'));
        on(this.dom.addCameraBtn, 'click', () => this.showCameraModal());
        on(this.dom.saveCameraBtn, 'click', () => this.saveCamera());
        on(this.dom.closeModal, 'click', () => this.hideModal());
        on(this.dom.cameraModal, 'click', e => e.target === e.currentTarget && this.hideModal());
        on(this.dom.applyFiltersBtn, 'click', () => { this.currentPage = 1; this.loadLogs(); });
        on(this.dom.markAllReadBtn, 'click', () => this.markAllRead());
        on(this.dom.filterAllBtn, 'click', () => this.setNotificationFilter('all'));
        on(this.dom.filterUnreadBtn, 'click', () => this.setNotificationFilter('unread'));
        on(this.dom.prevPage, 'click', () => this.prevPage());
        on(this.dom.nextPage, 'click', () => this.nextPage());
        on(this.dom.logsPerPage, 'change', () => this.changeLogsPerPage());
        on(this.dom.confirmCancel, 'click', () => this.hideConfirmModal());
        on(this.dom.confirmOk, 'click', () => this.executeLogout());
        on(this.dom.confirmModal, 'click', e => e.target === e.currentTarget && this.hideConfirmModal());
        on(this.dom.deleteCancel, 'click', () => this.hideDeleteModal());
        on(this.dom.deleteOk, 'click', () => this.executeDelete());
        on(this.dom.deleteModal, 'click', e => e.target === e.currentTarget && this.hideDeleteModal());
        on(this.dom.themeToggle, 'click', () => this.toggleTheme());

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', e => this.switchTab(e.currentTarget.dataset.tab));
        });

        document.addEventListener('visibilitychange', () => {
            this.isPageVisible = !document.hidden;
        });
    }

    setNotificationFilter(filter) {
        this.notificationFilter = filter;
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[data-filter="${filter}"]`)?.classList.add('active');
        this.renderNotifications();
    }

    showLogoutConfirm() {
        this.dom.confirmModal?.classList.remove('hidden');
    }

    hideConfirmModal() {
        this.dom.confirmModal?.classList.add('hidden');
    }

    async executeLogout() {
        this.hideConfirmModal();
        try { await fetch('/api/auth/logout', { method: 'POST', headers: this.getHeaders() }); } catch {}
        if (this.hubConnection) {
            try { await this.hubConnection.stop(); } catch {}
        }
        this.clearAuth();
        this.cameras = [];
        this.logs = [];
        this.notifications = [];
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
        if (this.dom.loginPassword) this.dom.loginPassword.value = '';
        if (this.dom.camerasList) this.dom.camerasList.innerHTML = '';
        this.showScreen('login');
    }

    showDeleteConfirm(id) {
        this.pendingDeleteId = id;
        this.dom.deleteModal?.classList.remove('hidden');
    }

    hideDeleteModal() {
        this.dom.deleteModal?.classList.add('hidden');
        this.pendingDeleteId = null;
    }

    async executeDelete() {
        if (!this.pendingDeleteId) return;
        const id = this.pendingDeleteId;
        this.hideDeleteModal();
        try {
            const r = await fetch(`/api/cameras/${id}`, { method: 'DELETE', headers: this.getHeaders() });
            if (r.ok) {
                this.cameras = this.cameras.filter(c => c.id !== id);
                this.renderCameras();
                this.showToast('Успешно', 'Камера удалена');
            }
        } catch {
            this.showToast('Ошибка', 'Не удалось удалить камеру');
        }
    }

    async login() {
        const username = this.dom.loginUsername?.value;
        const password = this.dom.loginPassword?.value;
        if (!username || !password) {
            this.showError('Заполните все поля');
            return;
        }

        const btn = this.dom.loginBtn;
        btn.disabled = true;
        btn.textContent = 'Вход...';

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (response.ok) {
                const data = await response.json();
                this.token = data.token;
                this.currentUser = data;
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data));
                if (this.dom.currentUsername) {
                    this.dom.currentUsername.textContent = data.username;
                }
                this.showScreen('dashboard');
                this.loadAllDataParallel();
            } else {
                const err = await response.json().catch(() => ({}));
                this.showError(err.error || 'Неверный логин или пароль');
            }
        } catch {
            this.showError('Ошибка подключения');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Войти';
        }
    }

    async connectSignalR() {
        if (this.hubConnection) {
            try { await this.hubConnection.stop(); } catch {}
        }

        this.updateSignalRStatus('disconnected', 'Подключение...');

        this.hubConnection = new signalR.HubConnectionBuilder()
            .withUrl('/notificationshub', { accessTokenFactory: () => this.token })
            .withAutomaticReconnect({
                nextRetryDelayInMilliseconds: ctx =>
                    ctx.elapsedMilliseconds < 60000 ? Math.random() * 2000 + 2000 : null
            })
            .configureLogging(signalR.LogLevel.Warning)
            .build();

        this.hubConnection.onreconnecting(() => {
            this.updateSignalRStatus('reconnecting', 'Переподключение...');
        });

        this.hubConnection.onreconnected(() => {
            this.updateSignalRStatus('connected', 'Онлайн');
            this.showToast('Соединение восстановлено', 'SignalR подключен');
        });

        this.hubConnection.onclose(() => {
            this.updateSignalRStatus('disconnected', 'Офлайн');
        });

        this.hubConnection.on('ReceiveNotification', n => this.handleNewNotification(n));
        this.hubConnection.on('CameraStatusChanged', (id, status) => this.updateCameraStatus(id, status));
        this.hubConnection.on('CameraAdded', c => {
            this.cameras.push(c);
            this.debouncedRenderCameras();
        });
        this.hubConnection.on('CameraUpdated', c => {
            const i = this.cameras.findIndex(x => x.id === c.id);
            if (i !== -1) {
                this.cameras[i] = c;
                this.debouncedRenderCameras();
            }
        });
        this.hubConnection.on('CameraDeleted', id => {
            this.cameras = this.cameras.filter(c => c.id !== id);
            this.debouncedRenderCameras();
        });
        this.hubConnection.on('ReceiveFrame', (id, frame) => {
            const img = document.getElementById(`camera-frame-${id}`);
            if (img) img.src = `data:image/jpeg;base64,${frame}`;
        });
        this.hubConnection.on('NewLogsBatch', logs => this.handleNewLogsBatch(logs));
        this.hubConnection.on('LogStatsUpdated', stats => this.handleStatsUpdate(stats));

        try {
            await this.hubConnection.start();
            this.updateSignalRStatus('connected', 'Онлайн');
        } catch (err) {
            console.error('SignalR:', err);
            this.updateSignalRStatus('disconnected', 'Ошибка подключения');
        }
    }

    handleNewLogsBatch(logs) {
        if (!this.isPageVisible || this.currentPage !== 1) return;

        this.logsBatch.push(...logs);
        clearTimeout(this.batchTimeout);
        this.batchTimeout = setTimeout(() => this.processBatchedLogs(), 500);
    }

    processBatchedLogs() {
        if (!this.logsBatch.length) return;

        const tbody = this.dom.logsTableBody;
        if (!tbody) return;

        if (tbody.querySelector('tr td[colspan]')) tbody.innerHTML = '';

        const fragment = document.createDocumentFragment();
        this.logsBatch.slice(0, 10).forEach(log => {
            const row = document.createElement('tr');
            row.className = `log-${log.level} log-new-entry`;
            row.innerHTML = `<td>${new Date(log.timestamp).toLocaleString()}</td><td><span class="badge-${log.level}">${log.level}</span></td><td>${log.cameraName || '-'}</td><td>${log.message}</td>`;
            fragment.appendChild(row);
        });

        tbody.insertBefore(fragment, tbody.firstChild);

        requestAnimationFrame(() => {
            tbody.querySelectorAll('.log-new-entry').forEach(row => {
                row.classList.remove('log-new-entry');
            });
        });

        while (tbody.children.length > this.logsPerPage) {
            tbody.removeChild(tbody.lastChild);
        }

        const alert = this.logsBatch.find(log => log.level === 'error' || log.level === 'warning');
        if (alert) {
            const msg = alert.message || '';
            this.showToast(
                alert.level === 'error' ? 'Ошибка' : 'Предупреждение',
                `${alert.cameraName || 'Система'}: ${msg.substring(0, 80)}${msg.length > 80 ? '...' : ''}`
            );
        }

        this.logsBatch = [];
    }

    debouncedRenderCameras() {
        clearTimeout(this.renderDebounce);
        this.renderDebounce = setTimeout(() => this.renderCameras(), 100);
    }

    updateSignalRStatus(status, text) {
        const el = this.dom.signalrStatus;
        if (!el) return;
        el.className = `signalr-status ${status}`;
        const span = el.querySelector('span');
        if (span) span.textContent = text;
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        const activeTab = document.querySelector(`[data-tab="${tabName}"]`);
        activeTab?.classList.add('active');
        document.getElementById(`${tabName}Tab`)?.classList.add('active');

        if (window.innerWidth <= 768 && activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    async loadCameras() {
        try {
            const response = await fetch('/api/cameras', { headers: this.getHeaders() });
            if (response.ok) {
                const data = await response.json();
                if (Array.isArray(data)) {
                    this.cameras = data;
                    this.renderCameras();
                }
            } else if (response.status === 401) {
                this.handleUnauthorized();
            }
        } catch (err) {
            console.error('Load cameras error:', err);
            this.showToast('Ошибка', 'Не удалось загрузить камеры');
        }
    }

    renderCameras() {
        const container = this.dom.camerasList;
        if (!container || !Array.isArray(this.cameras)) return;

        if (!this.cameras.length) {
            container.innerHTML = `<div class="empty-state"><i class="fas fa-video-slash"></i><h3>Камер пока нет</h3><p>Добавьте первую камеру</p></div>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        this.cameras.forEach(camera => {
            const card = document.createElement('div');
            const status = camera.status || 'offline';
            card.className = `camera-card ${status}`;
            card.innerHTML = `
                <div class="camera-header">
                    <h3>${camera.name || 'Без названия'}</h3>
                    <span class="status-badge ${status}">${status === 'online' ? 'Онлайн' : 'Офлайн'}</span>
                </div>
                <p><strong>Расположение:</strong> ${camera.location || '-'}</p>
                <p><strong>URL:</strong> ${camera.rtspUrl || '-'}</p>
                <div class="camera-actions">
                    <button onclick="app.viewStream(${camera.id})"><i class="fas fa-play"></i> Просмотр</button>
                    <button onclick="app.editCamera(${camera.id})"><i class="fas fa-edit"></i> Изменить</button>
                    <button onclick="app.deleteCamera(${camera.id})"><i class="fas fa-trash"></i> Удалить</button>
                </div>`;
            fragment.appendChild(card);
        });

        container.innerHTML = '';
        container.appendChild(fragment);
    }

    async loadLogs() {
        const logsParams = this.buildFilterParams(true);
        const statsParams = this.buildFilterParams(false);

        try {
            const [logsResponse, statsResponse] = await Promise.all([
                fetch(`/api/logs?${logsParams}`, { headers: this.getHeaders() }),
                fetch(`/api/logs/stats?${statsParams}`, { headers: this.getHeaders() })
            ]);

            if (logsResponse.ok) {
                const pagedData = await logsResponse.json();
                if (pagedData && Array.isArray(pagedData.logs)) {
                    this.logs = pagedData.logs.map(log => ({
                        id: log.id,
                        timestamp: log.timestamp,
                        level: log.level || 'info',
                        message: log.message || '',
                        cameraName: log.cameraName || `Camera ${log.cameraId || '-'}`,
                        cameraId: log.cameraId,
                        colorCode: log.colorCode
                    }));
                    this.totalLogsCount = pagedData.totalCount;
                    this.renderLogs();
                    this.updatePagination(pagedData.totalCount);
                }
            } else if (logsResponse.status === 401) {
                this.handleUnauthorized();
                return;
            }

            if (statsResponse.ok) {
                const stats = await statsResponse.json();
                if (stats) this.renderStats(stats);
            } else if (statsResponse.status === 401) {
                this.handleUnauthorized();
            }
        } catch (err) {
            console.error('Load logs error:', err);
            this.showToast('Ошибка', 'Не удалось загрузить логи');
        }
    }

    renderLogs() {
        const tbody = this.dom.logsTableBody;
        if (!tbody) return;

        if (!Array.isArray(this.logs)) this.logs = [];

        if (!this.logs.length) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--text-muted)">Логов нет</td></tr>';
            return;
        }

        const fragment = document.createDocumentFragment();
        this.logs.forEach(log => {
            const row = document.createElement('tr');
            row.className = `log-${log.level}`;
            row.innerHTML = `
                <td>${log.timestamp ? new Date(log.timestamp).toLocaleString('ru-RU') : '-'}</td>
                <td><span class="badge-${log.level}">${log.level}</span></td>
                <td>${log.cameraName || '-'}</td>
                <td>${log.message || ''}</td>`;
            fragment.appendChild(row);
        });

        tbody.innerHTML = '';
        tbody.appendChild(fragment);
    }

    updatePagination(totalLogs) {
        const totalPages = Math.ceil(totalLogs / this.logsPerPage) || 1;
        const startIndex = (this.currentPage - 1) * this.logsPerPage + 1;
        const endIndex = Math.min(startIndex + this.logsPerPage - 1, totalLogs);

        if (this.dom.paginationInfo) {
            this.dom.paginationInfo.textContent = totalLogs === 0
                ? 'Нет логов'
                : `Показано ${startIndex}-${endIndex} из ${totalLogs}`;
        }

        if (this.dom.prevPage) this.dom.prevPage.disabled = this.currentPage === 1;
        if (this.dom.nextPage) this.dom.nextPage.disabled = this.currentPage >= totalPages || totalLogs === 0;
        if (this.dom.logsPerPage) this.dom.logsPerPage.value = this.logsPerPage.toString();

        if (this.dom.pageNumbers) {
            const fragment = document.createDocumentFragment();

            if (totalPages <= 7) {
                for (let i = 1; i <= totalPages; i++) {
                    fragment.appendChild(this.createPageButton(i));
                }
            } else {
                fragment.appendChild(this.createPageButton(1));

                if (this.currentPage > 3) {
                    const dots = document.createElement('span');
                    dots.className = 'page-dots';
                    dots.textContent = '...';
                    fragment.appendChild(dots);
                }

                const start = Math.max(2, this.currentPage - 1);
                const end = Math.min(totalPages - 1, this.currentPage + 1);

                for (let i = start; i <= end; i++) {
                    fragment.appendChild(this.createPageButton(i));
                }

                if (this.currentPage < totalPages - 2) {
                    const dots = document.createElement('span');
                    dots.className = 'page-dots';
                    dots.textContent = '...';
                    fragment.appendChild(dots);
                }

                fragment.appendChild(this.createPageButton(totalPages));
            }

            this.dom.pageNumbers.innerHTML = '';
            this.dom.pageNumbers.appendChild(fragment);
        }
    }

    createPageButton(pageNum) {
        const btn = document.createElement('button');
        btn.className = `page-btn ${pageNum === this.currentPage ? 'active' : ''}`;
        btn.textContent = pageNum;
        btn.onclick = () => this.goToPage(pageNum);
        return btn;
    }

    goToPage(pageNum) {
        this.currentPage = pageNum;
        this.loadLogs();
    }

    nextPage() {
        if (this.currentPage < Math.ceil(this.totalLogsCount / this.logsPerPage)) {
            this.currentPage++;
            this.loadLogs();
        }
    }

    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.loadLogs();
        }
    }

    changeLogsPerPage() {
        if (this.dom.logsPerPage) {
            this.logsPerPage = parseInt(this.dom.logsPerPage.value);
            this.currentPage = 1;
            this.loadLogs();
        }
    }

    renderStats(stats) {
        this.logStats = {
            totalLogs: stats.totalLogs || 0,
            errors: stats.errors || 0,
            warnings: stats.warnings || 0,
            info: stats.info || 0
        };

        this.updateStatsDisplay();

        const canvas = this.dom.logsChart;
        if (!canvas || !stats.hourlyActivity) return;
        if (this.chart) this.chart.destroy();

        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, 'rgba(255,140,66,0.5)');
        gradient.addColorStop(0.5, 'rgba(255,140,66,0.2)');
        gradient.addColorStop(1, 'rgba(255,140,66,0.01)');

        const sortedKeys = Object.keys(stats.hourlyActivity).sort();
        const sortedData = sortedKeys.map(key => stats.hourlyActivity[key]);
        const isDark = this.currentTheme === 'dark';

        // Show filter info in chart label if filters are active
        const hasFilters = this.selectedLogLevel || this.dom.logDateFrom?.value || this.dom.logDateTo?.value;
        const chartLabel = hasFilters ? `Активность (${this.selectedLogLevel || 'все'})` : 'Активность';

        // Animation: none on initial load, smooth on filter changes
        const animationConfig = this.isInitialLoad
            ? { duration: 0 }
            : { duration: 400, easing: 'easeOutQuart' };

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sortedKeys,
                datasets: [{
                    label: chartLabel,
                    data: sortedData,
                    borderColor: 'rgb(255,140,66)',
                    backgroundColor: gradient,
                    borderWidth: 3,
                    tension: 0.42,
                    fill: true,
                    pointRadius: 0,
                    pointHoverRadius: 8,
                    pointHoverBackgroundColor: 'rgba(255,140,66,1)',
                    pointHoverBorderColor: '#fff',
                    pointHoverBorderWidth: 3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                animation: animationConfig,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'end',
                        labels: {
                            color: isDark ? '#c9d1d9' : '#1f2328',
                            font: { size: 13, weight: '600' },
                            usePointStyle: true,
                            pointStyle: 'circle',
                            padding: 20,
                            boxWidth: 8,
                            boxHeight: 8
                        }
                    },
                    tooltip: {
                        enabled: true,
                        backgroundColor: 'rgba(22,27,34,0.98)',
                        titleColor: '#ff8c42',
                        bodyColor: '#c9d1d9',
                        borderColor: 'rgba(255,140,66,0.5)',
                        borderWidth: 2,
                        padding: 16,
                        displayColors: false,
                        titleFont: { size: 14, weight: '700' },
                        bodyFont: { size: 13 },
                        cornerRadius: 12,
                        caretSize: 8,
                        callbacks: {
                            title: ctx => 'Час: ' + ctx[0].label,
                            label: ctx => 'Логи: ' + ctx.parsed.y
                        }
                    },
                    decimation: { enabled: true, algorithm: 'lttb', samples: 50 }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: isDark ? '#8b949e' : '#57606a',
                            font: { size: 12, weight: '500' },
                            padding: 10,
                            callback: v => Number.isInteger(v) ? v : ''
                        },
                        grid: {
                            color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
                            lineWidth: 1,
                            drawBorder: false
                        },
                        border: { display: false }
                    },
                    x: {
                        ticks: {
                            color: isDark ? '#8b949e' : '#57606a',
                            font: { size: 11, weight: '500' },
                            maxRotation: 0,
                            autoSkipPadding: 20
                        },
                        grid: {
                            color: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
                            lineWidth: 1,
                            drawBorder: false
                        },
                        border: { display: false }
                    }
                }
            }
        });
    }

    async loadNotifications() {
        try {
            const response = await fetch('/api/notifications', { headers: this.getHeaders() });
            if (response.ok) {
                this.notifications = await response.json();
                this.renderNotifications();
            } else if (response.status === 401) {
                this.handleUnauthorized();
            }
        } catch (err) {
            console.error('Load notifications:', err);
        }
    }

    renderNotifications() {
        const container = this.dom.notificationsList;
        if (!container) return;

        const filtered = this.notificationFilter === 'unread'
            ? this.notifications.filter(n => !n.isRead)
            : this.notifications;

        const unreadCount = this.notifications.filter(n => !n.isRead).length;

        if (this.dom.notificationBadge) {
            if (unreadCount > 0) {
                this.dom.notificationBadge.textContent = unreadCount;
                this.dom.notificationBadge.classList.remove('hidden');
            } else {
                this.dom.notificationBadge.classList.add('hidden');
            }
        }

        if (this.dom.notificationsCount) {
            this.dom.notificationsCount.textContent = this.notificationFilter === 'unread'
                ? unreadCount
                : this.notifications.length;
        }

        if (!filtered.length) {
            const msg = this.notificationFilter === 'unread' ? 'Нет непрочитанных' : 'Уведомлений нет';
            container.innerHTML = `<div class="empty-state"><i class="fas fa-bell-slash"></i><h3>${msg}</h3></div>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        filtered.forEach(n => {
            const div = document.createElement('div');
            div.className = `notification-item ${n.type} ${n.isRead ? '' : 'unread'}`;
            div.innerHTML = `
                <div class="notification-header">
                    <strong>${n.title}</strong>
                    <span>${new Date(n.timestamp).toLocaleString()}</span>
                </div>
                <p>${n.message}</p>
                ${!n.isRead ? `<button onclick="app.markAsRead(${n.id})">Прочитать</button>` : ''}`;
            fragment.appendChild(div);
        });

        container.innerHTML = '';
        container.appendChild(fragment);
    }

    handleNewNotification(n) {
        this.notifications.unshift(n);
        this.renderNotifications();
        this.showToast(n.title, n.message);
    }

    updateCameraStatus(id, status) {
        const c = this.cameras.find(x => x.id === id);
        if (c) {
            c.status = status;
            c.isOnline = status === 'online';
            this.debouncedRenderCameras();
        }
    }

    handleStatsUpdate(stats) {
        clearTimeout(this.statsDebounce);
        this.statsDebounce = setTimeout(() => {
            this.logStats = {
                totalLogs: stats.totalLogs || 0,
                errors: stats.errors || 0,
                warnings: stats.warnings || 0,
                info: stats.info || 0
            };
            this.updateStatsDisplay();
        }, 500);
    }

    updateStatsDisplay() {
        const stats = [
            { el: this.dom.totalLogs, value: this.logStats.totalLogs },
            { el: this.dom.errorLogs, value: this.logStats.errors },
            { el: this.dom.warningLogs, value: this.logStats.warnings },
            { el: this.dom.infoLogs, value: this.logStats.info }
        ];

        stats.forEach(({ el, value }) => {
            if (!el) return;
            const newValue = value.toString();
            if (el.textContent !== newValue) {
                el.textContent = newValue;
                el.classList.add('stat-value-updated');
                setTimeout(() => el.classList.remove('stat-value-updated'), 600);
            }
        });
    }

    handleUnauthorized() {
        this.clearAuth();
        this.showScreen('login');
        this.showError('Сессия истекла');
    }

    showError(msg) {
        const el = this.dom.loginError;
        if (el) {
            el.textContent = msg;
            el.classList.remove('hidden');
            setTimeout(() => el.classList.add('hidden'), 5000);
        }
    }

    showToast(title, msg) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.innerHTML = `<strong>${title}</strong><p>${msg}</p>`;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 5000);
    }

    viewStream(id) {
        window.open(`${this.streamApiUrl}/camera/${id}?token=${this.streamToken}`, '_blank');
    }

    editCamera(id) {
        const c = this.cameras.find(x => x.id === id);
        if (!c) return;
        if (this.dom.cameraName) this.dom.cameraName.value = c.name;
        if (this.dom.cameraLocation) this.dom.cameraLocation.value = c.location;
        if (this.dom.cameraRtspUrl) this.dom.cameraRtspUrl.value = c.rtspUrl;
        if (this.dom.cameraModal) {
            this.dom.cameraModal.dataset.editId = id;
            this.dom.cameraModal.classList.remove('hidden');
        }
    }

    deleteCamera(id) {
        this.showDeleteConfirm(id);
    }

    async markAsRead(id) {
        try {
            await fetch(`/api/notifications/${id}/read`, { method: 'POST', headers: this.getHeaders() });
            const n = this.notifications.find(x => x.id === id);
            if (n) {
                n.isRead = true;
                this.renderNotifications();
            }
        } catch {}
    }

    async markAllRead() {
        try {
            await fetch('/api/notifications/markallread', { method: 'POST', headers: this.getHeaders() });
            this.notifications.forEach(n => n.isRead = true);
            this.renderNotifications();
            this.showToast('Успешно', 'Все прочитано');
        } catch {}
    }

    showCameraModal() {
        if (this.dom.cameraName) this.dom.cameraName.value = '';
        if (this.dom.cameraLocation) this.dom.cameraLocation.value = '';
        if (this.dom.cameraRtspUrl) this.dom.cameraRtspUrl.value = '';
        if (this.dom.cameraModal) {
            delete this.dom.cameraModal.dataset.editId;
            this.dom.cameraModal.classList.remove('hidden');
        }
    }

    hideModal() {
        this.dom.cameraModal?.classList.add('hidden');
    }

    async saveCamera() {
        const name = this.dom.cameraName?.value;
        const location = this.dom.cameraLocation?.value;
        const rtspUrl = this.dom.cameraRtspUrl?.value;

        if (!name || !location || !rtspUrl) {
            this.showToast('Ошибка', 'Заполните все поля');
            return;
        }

        const btn = this.dom.saveCameraBtn;
        btn.disabled = true;
        const editId = this.dom.cameraModal?.dataset.editId;

        try {
            const camera = { name, location, rtspUrl, isActive: true };
            const response = editId
                ? await fetch(`/api/cameras/${editId}`, { method: 'PUT', headers: this.getHeaders(), body: JSON.stringify(camera) })
                : await fetch('/api/cameras', { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(camera) });

            if (response.ok) {
                this.hideModal();
                const data = await response.json();
                if (editId) {
                    const idx = this.cameras.findIndex(c => c.id == editId);
                    if (idx !== -1) this.cameras[idx] = data;
                } else {
                    this.cameras.push(data);
                }
                this.renderCameras();
                this.showToast('Успешно', editId ? 'Камера обновлена' : 'Камера добавлена');
            }
        } catch {
            this.showToast('Ошибка', 'Не удалось сохранить');
        } finally {
            btn.disabled = false;
        }
    }

    setStreamConfig(apiUrl, token) {
        this.streamApiUrl = apiUrl;
        this.streamToken = token;
        localStorage.setItem('streamApiUrl', apiUrl);
        localStorage.setItem('streamToken', token);
    }
}

const app = new CamerasCRM();
document.addEventListener('DOMContentLoaded', () => app.init());
