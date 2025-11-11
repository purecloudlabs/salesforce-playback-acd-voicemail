/**
 * VoicemailViewer Lightning Web Component
 * 
 * This component provides a comprehensive voicemail management interface for Genesys Cloud
 * voicemails within Salesforce. It handles authentication, real-time updates via WebSocket,
 * and provides full CRUD operations for voicemail messages.
 * 
 * Key Features:
 * - OAuth authentication with Genesys Cloud
 * - Real-time voicemail notifications via WebSocket
 * - Paginated voicemail list with search capabilities
 * - Audio playback with automatic read status updates
 * - Note editing and voicemail management (mark read/unread, delete)
 * - Utility bar integration with unread count badges
 */

import { LightningElement, track, api, wire } from 'lwc';
import { getRecord } from 'lightning/uiRecordApi';
import VendorCallKey from '@salesforce/schema/VoiceCall.VendorCallKey';
import CallType from '@salesforce/schema/VoiceCall.CallType';

// Optional: Enable permission-based access control
// import hasMyVoicePermission from '@salesforce/customPermission/Enterprise_VoiceMail_Utility_Access';

export default class VoicemailViewer extends LightningElement {
    // === PUBLIC PROPERTIES ===
    @api recordId; // Salesforce record ID (if used in record context)
    @api genesysCloudRegion = 'mypurecloud.com'; // Genesys Cloud region
    @api genesysCloudClientId; // OAuth client ID for Genesys Cloud

    // === COMPONENT STATE ===
    @track conversationId = ''; // Current conversation ID
    @track CallType; // Type of call (from Salesforce VoiceCall record)
    @track audioUrl = null; // Current audio URL for playback
    @track errorMessage = null; // Error message to display to user
    @track isLoading = false; // Loading state indicator
    @track isAuthenticated = false; // Authentication status
    @track hasVoicemail = false; // Whether any voicemails exist

    // === VOICEMAIL DATA ===
    @track voicemails = []; // Array of voicemail objects
    @track loadedAudioUrls = new Map(); // Cache for loaded audio URLs
    @track lastUpdated = ''; // Timestamp of last data refresh

    // === PAGINATION ===
    @track currentPage = 1; // Current page number
    @track pageSize = 25; // Number of items per page
    @track pageCount = 0; // Total number of pages
    @track displayCount = 0; // Number of items currently displayed

    // === WEBSOCKET CONNECTION ===
    @track websocket = null; // WebSocket connection for real-time updates
    @track channelId = null; // Genesys Cloud notification channel ID
    @track isWebSocketConnected = false; // WebSocket connection status

    // === COMPUTED PROPERTIES ===
    
    /**
     * Determines if the component should be visible
     * @returns {boolean} Always true (modify for permission-based access)
     */
    get shouldShowCard() {
        return true;
        // For permission-based access, uncomment:
        // return hasMyVoicePermission ? true : false;
    }

    /**
     * Checks if there are more pages available
     * @returns {boolean} True if next page exists
     */
    get hasNextPage() {
        return this.currentPage < this.pageCount;
    }

    /**
     * Checks if we're on the first page
     * @returns {boolean} True if on first page
     */
    get hasPreviousPage() {
        return this.currentPage <= 1;
    }

    /**
     * Determines if next page button should be disabled
     * @returns {boolean} True if next button should be disabled
     */
    get disableNextPage() {
        return !this.hasNextPage;
    }

    /**
     * Determines if pagination controls should be shown
     * @returns {boolean} True if more than one page exists
     */
    get showPagination() {
        return this.pageCount > 1;
    }

    // === LIFECYCLE METHODS ===
    
    /**
     * Wired method to get VoiceCall record data from Salesforce
     * Automatically loads voicemails if authenticated when call data is received
     */
    @wire(getRecord, { recordId: '$recordId', fields: [VendorCallKey, CallType] })
    wiredVoiceCall(result) {
        this.VoiceCall = result;
        if (result.data) {
            this.CallType = result.data.fields.CallType.value;

            if (this.isAuthenticated) {
                // Delay to ensure UI is ready
                setTimeout(() => {
                    this.loadVoicemails();
                }, 2000);
            }
        }
    }

    /**
     * Component initialization when inserted into DOM
     * Sets up authentication, event listeners, and loads initial data
     */
    connectedCallback() {
        // Optional permission check
        // if (!hasMyVoicePermission) return;

        // Check for existing authentication
        const accessToken = this.getAccessToken();
        this.isAuthenticated = !!accessToken;

        // Initialize UI state
        this.clearNotificationBadge();
        document.addEventListener('click', this.handleOutsideClick.bind(this));

        if (this.isAuthenticated) {
            // Load data and setup real-time updates
            this.loadVoicemails(true);
            this.setupWebSocketNotifications();
        } else {
            // Trigger authentication flow
            this.handleLogin();
        }
    }

    /**
     * Cleanup when component is removed from DOM
     * Removes event listeners and closes WebSocket connections
     */
    disconnectedCallback() {
        document.removeEventListener('click', this.handleOutsideClick.bind(this));
        this.closeWebSocket();
    }

    // === EVENT HANDLERS ===
    
    /**
     * Handles clicks outside the component to close open menus
     * @param {Event} event - Click event
     */
    handleOutsideClick(event) {
        const hasOpenMenu = this.voicemails.some(vm => vm.showMenu);
        if (hasOpenMenu) {
            this.voicemails = this.voicemails.map(vm => ({ ...vm, showMenu: false }));
        }
    }

    // === AUTHENTICATION METHODS ===
    
    /**
     * Sets up listener for OAuth callback messages from popup window
     * Handles the authorization code exchange process
     */
    setupAuthListener() {
        window.addEventListener('message', async (event) => {
            if (!this.isValidAuthEvent(event)) {
                return;
            }
            
            try {
                await this.processAuthCallback(event.data);
            } catch (error) {
                console.error('Error processing auth callback message:', error);
                this.errorMessage = 'Failed to complete authentication';
            }
        });
    }
    
    /**
     * Validates incoming authentication callback events
     * @param {MessageEvent} event - Window message event
     * @returns {boolean} True if valid auth event
     */
    isValidAuthEvent(event) {
        return event.origin === window.location.origin &&
               event.data &&
               event.data.type === 'GENESYS_AUTH_CALLBACK' &&
               event.data.code;
    }
    
    /**
     * Processes the OAuth callback data and exchanges code for token
     * @param {Object} data - Callback data containing authorization code
     */
    async processAuthCallback(data) {
        const accessToken = await this.exchangeCodeForToken(data.code);
        if (!accessToken) {
            return;
        }
        
        this.isAuthenticated = true;
        this.initializeAfterAuth();
    }
    
    /**
     * Initializes component after successful authentication
     * Loads voicemails and sets up real-time notifications
     */
    initializeAfterAuth() {
        setTimeout(() => {
            this.loadVoicemails(true);
            this.setupWebSocketNotifications();
        }, 2000);
    }

    handleAuthCallback() {
        try {
            // Parse the URL hash fragment
            const fragmentParams = new URLSearchParams(window.location.hash.substring(1));
            const accessToken = fragmentParams.get('access_token');
            const expiresIn = fragmentParams.get('expires_in');

            if (accessToken) {
                // Store the token
                localStorage.setItem('genesyscloud_access_token', accessToken);

                // Calculate and store expiration time
                const expirationTime = Date.now() + (parseInt(expiresIn, 10) * 1000);
                localStorage.setItem('genesyscloud_token_expiration', expirationTime.toString());

                this.isAuthenticated = true;

                // Clean up the URL
                history.replaceState(null, document.title, window.location.pathname + window.location.search);
            }
        } catch (error) {
            console.error('Error handling authentication callback:', error);
            this.errorMessage = 'Failed to complete authentication';
        }
    }

    async handleLogin() {
        const codeVerifier = this.generateCodeVerifier();
        const codeChallenge = await this.generateCodeChallenge(codeVerifier);
        
        sessionStorage.setItem('pkce_code_verifier', codeVerifier);
        
        const redirectUri = encodeURIComponent(window.location.origin + '/resource/GenesysAuthCallback');
        const authUrl = `https://login.${this.genesysCloudRegion}/oauth/authorize` +
            `?client_id=${this.genesysCloudClientId}` +
            `&response_type=code` +
            `&redirect_uri=${redirectUri}` +
            `&scope=conversations voicemail` +
            `&code_challenge=${codeChallenge}` +
            `&code_challenge_method=S256`;

        const width = 600;
        const height = 700;
        const left = (screen.width / 2) - (width / 2);
        const top = (screen.height / 2) - (height / 2);

        const authWindow = window.open(
            authUrl,
            'GenesysCloudAuth',
            `width=${width},height=${height},left=${left},top=${top}`
        );

        this.setupAuthListener();

        if (!authWindow || authWindow.closed || typeof authWindow.closed === 'undefined') {
            this.errorMessage = 'Popup blocked. Please allow popups for this site.';
        }
    }


    async loadVoicemails(showLoader = true) {
        try {
            this.isLoading = showLoader;
            this.errorMessage = null;

            const accessToken = this.getAccessToken();
            if (!accessToken) {
                this.handleLogin();
                return;
            }

            const searchBody = {
                sortOrder: 'DESC',
                sortBy: 'createdTime',
                pageSize: this.pageSize,
                pageNumber: this.currentPage,
                query: [
                    { type: 'EXACT', fields: ['owner'], value: 'ALL' },
                    { type: 'EXACT', fields: ['deleted'], value: 'false' }
                ]
            };

            const voicemailsResponse = await this.callGenesysCloudApi(
                '/api/v2/voicemail/search',
                'POST',
                searchBody,
                accessToken
            );

            if (!voicemailsResponse || !voicemailsResponse.results) {
                this.voicemails = [];
                this.pageCount = 0;
                this.displayCount = 0;
                this.hasVoicemail = false;
                this.lastUpdated = `Last updated: ${new Date().toLocaleTimeString()}`;
                this.updateUtilityBar();
                return;
            }



            this.voicemails = voicemailsResponse.results
                .filter(vm => !vm.deleted)
                .map(vm => {
                    const existing = this.voicemails.find(v => v.id === vm.id);
                    const callerAddress = vm.callerAddress || '';
                    return {
                        ...vm,
                        formattedDuration: this.formatDuration(vm.audioRecordingDurationSeconds),
                        formattedDate: this.formatDate(vm.createdDate),
                        relativeTime: this.getRelativeTime(vm.createdDate),
                        isLoading: existing?.isLoading || false,
                        audioUrl: existing?.audioUrl || null,
                        audioElementId: `audio-${vm.id}`,
                        read: vm.read || false,
                        cardClass: this.getCardClass(vm.read, existing?.isExpanded || false),
                        callerClass: vm.read ? 'read-text' : 'unread-text',
                        readMenuLabel: vm.read ? 'Mark as Unread' : 'Mark as Read',
                        note: vm.note || '',
                        isEditing: existing?.isEditing || false,
                        isExpanded: existing?.isExpanded || false,
                        originalNote: vm.note || '',
                        showMenu: false,
                        fullCallerAddress: callerAddress.length > 15 ? callerAddress.substring(0, 15) + '...' : callerAddress,
                        phoneNumber: this.extractPhoneNumber(callerAddress)
                    };
                });

            this.pageCount = voicemailsResponse.pageCount || 0;
            this.displayCount = this.voicemails.length;
            this.hasVoicemail = this.voicemails.length > 0;
            this.lastUpdated = `Last updated: ${new Date().toLocaleTimeString()}`;

            // Update utility bar with unread count
            this.updateUtilityBar();
        } catch (error) {
            if (error.message && error.message.includes('401')) {
                localStorage.removeItem('genesyscloud_access_token');
                localStorage.removeItem('genesyscloud_token_expiration');
                this.isAuthenticated = false;
                this.handleLogin();
                return;
            }

            this.errorMessage = error.message || 'An error occurred while retrieving voicemails';
            console.error('Voicemail retrieval error:', error);
        } finally {
            this.isLoading = false;
        }
    }



    handleNextPage() {
        if (this.hasNextPage) {
            this.currentPage++;
            this.loadVoicemails(true);
        }
    }

    handlePreviousPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.loadVoicemails(true);
        }
    }

    getAccessToken() {
        const token = localStorage.getItem('genesyscloud_access_token');
        const expiration = localStorage.getItem('genesyscloud_token_expiration');

        // Check if token exists and is not expired
        if (token && expiration) {
            const now = Date.now();
            if (now < parseInt(expiration, 10)) {
                return token;
            } else {
                // Token expired, clear it
                localStorage.removeItem('genesyscloud_access_token');
                localStorage.removeItem('genesyscloud_token_expiration');
                this.isAuthenticated = false;
            }
        }

        return null;
    }

    async callGenesysCloudApi(endpoint, method, body, accessToken) {
        try {
            const url = `https://api.${this.genesysCloudRegion}` + endpoint;
            const options = {
                method: method,
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            };

            if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
                options.body = JSON.stringify(body);
            }

            const response = await fetch(url, options);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error (${response.status}): ${errorText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API call error:', error);
            throw error;
        }
    }

    formatDuration(durationSeconds) {
        if (!durationSeconds) return '0:00';

        const minutes = Math.floor(durationSeconds / 60);
        const remainingSeconds = durationSeconds % 60;

        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    formatDate(dateString) {
        if (!dateString) return '';
        return new Date(dateString).toLocaleString();
    }

    async markVoicemailAsRead(voicemailId) {
        try {
            const accessToken = this.getAccessToken();
            await this.callGenesysCloudApi(
                `/api/v2/voicemail/messages/${voicemailId}`,
                'PUT',
                { read: true },
                accessToken
            );
        } catch (error) {
            console.error('Failed to mark voicemail as read:', error);
        }
    }

    handleMenuToggle(event) {
        event.stopPropagation();
        const voicemailId = event.currentTarget.dataset.id;

        this.voicemails = this.voicemails.map(vm => ({
            ...vm,
            showMenu: vm.id === voicemailId ? !vm.showMenu : false
        }));
    }

    handleToggleRead(event) {
        event.stopPropagation();
        const voicemailId = event.currentTarget.dataset.id;
        if (!voicemailId) return;

        const voicemailIndex = this.voicemails.findIndex(vm => vm.id === voicemailId);
        if (voicemailIndex === -1) return;

        this.voicemails[voicemailIndex].showMenu = false;
        const newReadStatus = !this.voicemails[voicemailIndex].read;
        this.updateVoicemail(voicemailId, { read: newReadStatus });
    }

    async handleCardClick(event) {
        event.stopPropagation();
        const voicemailId = event.currentTarget.dataset.id;
        const voicemailIndex = this.voicemails.findIndex(vm => vm.id === voicemailId);
        if (voicemailIndex === -1) return;

        // Close all menus
        this.voicemails = this.voicemails.map(vm => ({ ...vm, showMenu: false }));

        this.voicemails[voicemailIndex].isExpanded = !this.voicemails[voicemailIndex].isExpanded;
        this.voicemails[voicemailIndex].cardClass = this.getCardClass(
            this.voicemails[voicemailIndex].read,
            this.voicemails[voicemailIndex].isExpanded
        );

        // Reset editing state and note when collapsing
        if (!this.voicemails[voicemailIndex].isExpanded) {
            this.voicemails[voicemailIndex].isEditing = false;
            this.voicemails[voicemailIndex].note = this.voicemails[voicemailIndex].originalNote;
        } else {
            // Auto-load audio when expanded
            if (!this.voicemails[voicemailIndex].audioUrl) {
                await this.loadVoicemailAudio(voicemailId);
            }
        }

        this.voicemails = [...this.voicemails];
    }

    handleMenuClick(event) {
        event.stopPropagation();
    }

    handleStopPropagation(event) {
        event.stopPropagation();
    }



    async handlePlayVoicemail(event) {
        event.stopPropagation();
        const voicemailId = event.target.dataset.id;
        await this.loadVoicemailAudio(voicemailId);
    }

    async loadVoicemailAudio(voicemailId) {
        const voicemailIndex = this.voicemails.findIndex(vm => vm.id === voicemailId);
        if (voicemailIndex === -1) return;

        if (this.loadedAudioUrls.has(voicemailId)) {
            this.voicemails[voicemailIndex].audioUrl = this.loadedAudioUrls.get(voicemailId);
            return;
        }

        try {
            this.voicemails[voicemailIndex].isLoading = true;
            this.voicemails = [...this.voicemails];

            const accessToken = this.getAccessToken();
            const mediaResponse = await this.callGenesysCloudApi(
                `/api/v2/voicemail/messages/${voicemailId}/media?formatId=WAV`,
                'GET',
                null,
                accessToken
            );

            if (mediaResponse && mediaResponse.mediaFileUri) {
                this.voicemails[voicemailIndex].audioUrl = mediaResponse.mediaFileUri;
                this.loadedAudioUrls.set(voicemailId, mediaResponse.mediaFileUri);
            } else {
                throw new Error('Failed to retrieve voicemail audio');
            }
        } catch (error) {
            this.errorMessage = `Failed to load audio: ${error.message}`;
        } finally {
            this.voicemails[voicemailIndex].isLoading = false;
            this.voicemails = [...this.voicemails];
        }
    }

    handleEditNote(event) {
        event.stopPropagation();
        const voicemailId = event.target.dataset.id || event.detail.value;
        const voicemailIndex = this.voicemails.findIndex(vm => vm.id === voicemailId);
        if (voicemailIndex === -1) return;

        this.voicemails[voicemailIndex].isEditing = true;
        this.voicemails = [...this.voicemails];
    }

    handleNoteChange(event) {
        const voicemailId = event.target.dataset.id;
        const voicemailIndex = this.voicemails.findIndex(vm => vm.id === voicemailId);
        if (voicemailIndex === -1) return;

        this.voicemails[voicemailIndex].note = event.target.value;
    }

    handleSaveNote(event) {
        event.stopPropagation();
        const voicemailId = event.target.dataset.id;
        const voicemailIndex = this.voicemails.findIndex(vm => vm.id === voicemailId);
        if (voicemailIndex === -1) return;

        const note = this.voicemails[voicemailIndex].note;
        this.updateVoicemail(voicemailId, { note });
        this.voicemails[voicemailIndex].originalNote = note;
        this.voicemails[voicemailIndex].isEditing = false;
        this.voicemails = [...this.voicemails];
    }

    handleCancelEdit(event) {
        event.stopPropagation();
        const voicemailId = event.target.dataset.id;
        const voicemailIndex = this.voicemails.findIndex(vm => vm.id === voicemailId);
        if (voicemailIndex === -1) return;

        this.voicemails[voicemailIndex].isEditing = false;
        this.voicemails = [...this.voicemails];
    }

    handleDelete(event) {
        event.stopPropagation();
        const voicemailId = event.currentTarget.dataset.id;
        if (!voicemailId) return;

        const isLastPage = this.currentPage === this.pageCount;
        const isLastItemOnPage = this.voicemails.length === 1;

        this.updateVoicemail(voicemailId, { deleted: true });
        this.voicemails = this.voicemails.filter(vm => vm.id !== voicemailId);
        this.displayCount = this.voicemails.length;
        this.updateUtilityBar();

        // If deleted last item on last page and not on first page, go to previous page
        if (isLastPage && isLastItemOnPage && this.currentPage > 1) {
            this.currentPage--;
            this.loadVoicemails(true);
        }
    }

    async updateVoicemail(voicemailId, updates) {
        try {
            const accessToken = this.getAccessToken();
            await this.callGenesysCloudApi(
                `/api/v2/voicemail/messages/${voicemailId}`,
                'PATCH',
                updates,
                accessToken
            );

            const voicemailIndex = this.voicemails.findIndex(vm => vm.id === voicemailId);
            if (voicemailIndex !== -1 && updates.read !== undefined) {
                this.voicemails[voicemailIndex].read = updates.read;
                this.voicemails[voicemailIndex].readMenuLabel = updates.read ? 'Mark as Unread' : 'Mark as Read';
                this.voicemails[voicemailIndex].cardClass = this.getCardClass(
                    updates.read,
                    this.voicemails[voicemailIndex].isExpanded
                );
                this.voicemails[voicemailIndex].callerClass = updates.read ? 'read-text' : 'unread-text';
                this.voicemails = [...this.voicemails];
                this.updateUtilityBar();
            }
        } catch (error) {
            this.errorMessage = `Failed to update voicemail: ${error.message}`;
        }
    }

    // === UTILITY METHODS ===
    
    /**
     * Converts a date string to relative time format (e.g., "2 hours ago")
     * @param {string} dateString - ISO date string
     * @returns {string} Formatted relative time string
     */
    getRelativeTime(dateString) {
        if (!dateString) return '';

        const diffMs = new Date() - new Date(dateString);
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        
        if (diffHours < 1) {
            return this.formatMinutesAgo(diffMs);
        }
        
        if (diffHours < 24) {
            return this.formatHoursAgo(diffHours);
        }
        
        return this.formatDaysAgo(Math.floor(diffHours / 24));
    }
    
    /**
     * Formats time difference in minutes
     * @param {number} diffMs - Time difference in milliseconds
     * @returns {string} Formatted minutes string
     */
    formatMinutesAgo(diffMs) {
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        return diffMinutes < 1 ? 'Just now' : `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
    }
    
    /**
     * Formats time difference in hours
     * @param {number} diffHours - Time difference in hours
     * @returns {string} Formatted hours string
     */
    formatHoursAgo(diffHours) {
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    }
    
    /**
     * Formats time difference in days
     * @param {number} diffDays - Time difference in days
     * @returns {string} Formatted days string
     */
    formatDaysAgo(diffDays) {
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }

    handleRefresh() {
        this.loadVoicemails(true);
    }

    handleAudioEnded(event) {
        const voicemailId = event.target.dataset.id;
        const voicemail = this.voicemails.find(vm => vm.id === voicemailId);
        if (voicemail && !voicemail.read) {
            this.updateVoicemail(voicemailId, { read: true });
        }
    }

    parseValueBetweenColons(inputString) {
        if (!inputString) return null;

        const firstColonIndex = inputString.indexOf(':');
        if (firstColonIndex === -1) return null;

        const secondColonIndex = inputString.indexOf(':', firstColonIndex + 1);
        if (secondColonIndex === -1) return null;

        return inputString.substring(firstColonIndex + 1, secondColonIndex);
    }

    getCardClass(isRead, isExpanded) {
        const baseClass = 'slds-card slds-m-bottom_small';
        const readClass = isRead ? 'read-card' : 'unread-card';
        const expandedClass = isExpanded ? 'expanded-card' : '';
        return `${baseClass} ${readClass} ${expandedClass}`.trim();
    }

    get unreadCount() {
        return this.voicemails.filter(vm => !vm.read).length;
    }

    updateUtilityBar() {
        const unread = this.unreadCount;
        this.dispatchEvent(new CustomEvent('voicemailcount', {
            detail: { count: unread },
            bubbles: true,
            composed: true
        }));
    }

    clearNotificationBadge() {
        this.dispatchEvent(new CustomEvent('voicemailcount', {
            detail: { count: 0 },
            bubbles: true,
            composed: true
        }));
    }

    async setupWebSocketNotifications() {
        try {
            const accessToken = this.getAccessToken();
            if (!accessToken) {
                console.log('No access token for WebSocket');
                return;
            }

            console.log('Setting up WebSocket notifications...');

            const userResponse = await this.callGenesysCloudApi('/api/v2/users/me', 'GET', null, accessToken);
            const userId = userResponse.id;

            const channelResponse = await this.callGenesysCloudApi(
                '/api/v2/notifications/channels',
                'POST',
                {},
                accessToken
            );

            this.channelId = channelResponse.id;
            const wsUri = channelResponse.connectUri;

            const topic = `v2.users.${userId}.voicemail.messages`;
            console.log('Subscribing to:', topic);

            await this.callGenesysCloudApi(
                `/api/v2/notifications/channels/${this.channelId}/subscriptions`,
                'POST',
                [{ id: topic }],
                accessToken
            );
            console.log('Subscription successful');

            this.websocket = new WebSocket(wsUri);

            this.websocket.onopen = () => {
                this.isWebSocketConnected = true;
                console.log('✅ WebSocket connected - Real-time updates active');
            };

            this.websocket.onmessage = (event) => {
                console.log('WebSocket message:', event.data);
                const message = JSON.parse(event.data);
                if (message.topicName && message.topicName.includes('voicemail.messages')) {
                    console.log('Voicemail event detected, refreshing...');
                    this.handleVoicemailNotification(message);
                }
            };

            this.websocket.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.isWebSocketConnected = false;
            };

            this.websocket.onclose = (event) => {
                console.log('WebSocket closed:', event.code, event.reason);
                this.isWebSocketConnected = false;
                setTimeout(() => {
                    if (this.isAuthenticated) {
                        console.log('Reconnecting WebSocket...');
                        this.setupWebSocketNotifications();
                    }
                }, 5000);
            };
        } catch (error) {
            console.error('❌ WebSocket setup failed:', error);
        }
    }

    handleVoicemailNotification(message) {
        setTimeout(() => {
            this.loadVoicemails(false);
        }, 2000);
    }

    closeWebSocket() {
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }
        this.isWebSocketConnected = false;
    }

    generateCodeVerifier() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return btoa(String.fromCharCode.apply(null, array))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    async generateCodeChallenge(verifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode.apply(null, new Uint8Array(digest)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    async exchangeCodeForToken(authCode) {
        try {
            const codeVerifier = sessionStorage.getItem('pkce_code_verifier');
            if (!codeVerifier) {
                throw new Error('Code verifier not found');
            }
            
            const tokenResponse = await fetch(`https://login.${this.genesysCloudRegion}/oauth/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: this.genesysCloudClientId,
                    code: authCode,
                    redirect_uri: window.location.origin + '/resource/GenesysAuthCallback',
                    code_verifier: codeVerifier
                })
            });
            
            if (!tokenResponse.ok) {
                throw new Error('Token exchange failed');
            }
            
            const tokenData = await tokenResponse.json();
            
            localStorage.setItem('genesyscloud_access_token', tokenData.access_token);
            const expirationTime = Date.now() + (tokenData.expires_in * 1000);
            localStorage.setItem('genesyscloud_token_expiration', expirationTime.toString());
            
            sessionStorage.removeItem('pkce_code_verifier');
            
            return tokenData.access_token;
        } catch (error) {
            console.error('Token exchange error:', error);
            this.errorMessage = 'Failed to exchange authorization code for token';
            return null;
        }
    }

    extractPhoneNumber(callerAddress) {
        if (!callerAddress) return null;
        const match = callerAddress.match(/\+?\d[\d\s\-\(\)]+/);
        return match ? match[0].replace(/[\s\-\(\)]/g, '') : null;
    }
}