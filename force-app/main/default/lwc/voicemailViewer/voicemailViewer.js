/**
 * VoicemailViewer Lightning Web Component
 * Main component file - imports utility modules for organization
 */

import { LightningElement, track, api, wire } from 'lwc';
import { getRecord } from 'lightning/uiRecordApi';
import VendorCallKey from '@salesforce/schema/VoiceCall.VendorCallKey';
import CallType from '@salesforce/schema/VoiceCall.CallType';
import { generateCodeVerifier, generateCodeChallenge, exchangeCodeForToken, getAccessToken } from './authUtils';
import { formatDuration, formatDate, getRelativeTime, getCardClass, extractPhoneNumber, parseValueBetweenColons } from './formatUtils';
import { callGenesysCloudApi, markVoicemailAsRead } from './apiUtils';
import { setupWebSocket, closeWebSocket } from './websocketUtils';

export default class VoicemailViewer extends LightningElement {
    @api recordId;
    @api genesysCloudRegion = 'mypurecloud.com';
    @api genesysCloudClientId;

    @track conversationId = '';
    @track CallType;
    @track audioUrl = null;
    @track errorMessage = null;
    @track isLoading = false;
    @track isAuthenticated = false;
    @track hasVoicemail = false;
    @track voicemails = [];
    @track loadedAudioUrls = new Map();
    @track lastUpdated = '';
    @track currentPage = 1;
    @track pageSize = 25;
    @track pageCount = 0;
    @track displayCount = 0;
    @track websocket = null;
    @track channelId = null;
    @track isWebSocketConnected = false;
    
    get shouldShowCard() {
        return true;
    }

    get hasNextPage() {
        return this.currentPage < this.pageCount;
    }

    get hasPreviousPage() {
        return this.currentPage <= 1;
    }

    get disableNextPage() {
        return !this.hasNextPage;
    }

    get showPagination() {
        return this.pageCount > 1;
    }

    get unreadCount() {
        return this.voicemails.filter(vm => !vm.read).length;
    }

    @wire(getRecord, { recordId: '$recordId', fields: [VendorCallKey, CallType] })
    wiredVoiceCall(result) {
        this.VoiceCall = result;
        if (result.data) {
            this.CallType = result.data.fields.CallType.value;
            if (this.isAuthenticated) {
                setTimeout(() => this.loadVoicemails(), 2000);
            }
        }
    }

    connectedCallback() {
        const accessToken = getAccessToken();
        this.isAuthenticated = !!accessToken;
        this.clearNotificationBadge();
        document.addEventListener('click', this.handleOutsideClick.bind(this));

        if (this.isAuthenticated) {
            this.loadVoicemails(true);
            this.setupWebSocketNotifications();
        } else {
            this.handleLogin();
        }
    }

    disconnectedCallback() {
        document.removeEventListener('click', this.handleOutsideClick.bind(this));
        closeWebSocket(this.websocket);
        this.websocket = null;
    }

    handleOutsideClick(event) {
        const hasOpenMenu = this.voicemails.some(vm => vm.showMenu);
        if (hasOpenMenu) {
            this.voicemails = this.voicemails.map(vm => ({ ...vm, showMenu: false }));
        }
    }

    setupAuthListener() {
        window.addEventListener('message', async (event) => {
            if (!this.isValidAuthEvent(event)) return;
            
            try {
                await this.processAuthCallback(event.data);
            } catch (error) {
                console.error('Error processing auth callback message:', error);
                this.errorMessage = 'Failed to complete authentication';
            }
        });
    }
    
    isValidAuthEvent(event) {
        return event.origin === window.location.origin &&
               event.data &&
               event.data.type === 'GENESYS_AUTH_CALLBACK' &&
               event.data.code;
    }
    
    async processAuthCallback(data) {
        const accessToken = await exchangeCodeForToken(data.code, this.genesysCloudClientId, this.genesysCloudRegion);
        if (!accessToken) return;
        
        this.isAuthenticated = true;
        this.initializeAfterAuth();
    }
    
    initializeAfterAuth() {
        setTimeout(() => {
            this.loadVoicemails(true);
            this.setupWebSocketNotifications();
        }, 2000);
    }

    async handleLogin() {
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        
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

        const authWindow = window.open(authUrl, 'GenesysCloudAuth', `width=${width},height=${height},left=${left},top=${top}`);
        this.setupAuthListener();

        if (!authWindow || authWindow.closed || typeof authWindow.closed === 'undefined') {
            this.errorMessage = 'Popup blocked. Please allow popups for this site.';
        }
    }

    async loadVoicemails(showLoader = true) {
        try {
            this.isLoading = showLoader;
            this.errorMessage = null;

            const accessToken = getAccessToken();
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

            const voicemailsResponse = await callGenesysCloudApi('/api/v2/voicemail/search', 'POST', searchBody, accessToken, this.genesysCloudRegion);

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
                .map(vm => this.mapVoicemailData(vm));

            this.pageCount = voicemailsResponse.pageCount || 0;
            this.displayCount = this.voicemails.length;
            this.hasVoicemail = this.voicemails.length > 0;
            this.lastUpdated = `Last updated: ${new Date().toLocaleTimeString()}`;
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

        this.voicemails = this.voicemails.map(vm => ({ ...vm, showMenu: false }));
        this.voicemails[voicemailIndex].isExpanded = !this.voicemails[voicemailIndex].isExpanded;
        this.voicemails[voicemailIndex].cardClass = getCardClass(
            this.voicemails[voicemailIndex].read,
            this.voicemails[voicemailIndex].isExpanded
        );

        if (!this.voicemails[voicemailIndex].isExpanded) {
            this.voicemails[voicemailIndex].isEditing = false;
            this.voicemails[voicemailIndex].note = this.voicemails[voicemailIndex].originalNote;
        } else {
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

            const accessToken = getAccessToken();
            const mediaResponse = await callGenesysCloudApi(
                `/api/v2/voicemail/messages/${voicemailId}/media?formatId=WAV`,
                'GET',
                null,
                accessToken,
                this.genesysCloudRegion
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

        if (isLastPage && isLastItemOnPage && this.currentPage > 1) {
            this.currentPage--;
            this.loadVoicemails(true);
        }
    }

    async updateVoicemail(voicemailId, updates) {
        try {
            const accessToken = getAccessToken();
            await callGenesysCloudApi(
                `/api/v2/voicemail/messages/${voicemailId}`,
                'PATCH',
                updates,
                accessToken,
                this.genesysCloudRegion
            );

            const voicemailIndex = this.voicemails.findIndex(vm => vm.id === voicemailId);
            if (voicemailIndex !== -1 && updates.read !== undefined) {
                this.voicemails[voicemailIndex].read = updates.read;
                this.voicemails[voicemailIndex].readMenuLabel = updates.read ? 'Mark as Unread' : 'Mark as Read';
                this.voicemails[voicemailIndex].cardClass = getCardClass(updates.read, this.voicemails[voicemailIndex].isExpanded);
                this.voicemails[voicemailIndex].callerClass = updates.read ? 'read-text' : 'unread-text';
                this.voicemails = [...this.voicemails];
                this.updateUtilityBar();
            }
        } catch (error) {
            this.errorMessage = `Failed to update voicemail: ${error.message}`;
        }
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
        const accessToken = getAccessToken();
        const result = await setupWebSocket(
            accessToken,
            this.genesysCloudRegion,
            (message) => this.handleVoicemailNotification(message),
            (isConnected) => { this.isWebSocketConnected = isConnected; }
        );

        if (result) {
            this.websocket = result.websocket;
            this.channelId = result.channelId;

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
        }
    }

    handleVoicemailNotification(message) {
        setTimeout(() => {
            this.loadVoicemails(false);
        }, 2000);
    }

    mapVoicemailData(vm) {
        const existing = this.voicemails.find(v => v.id === vm.id);
        const callerAddress = vm.callerAddress || '';
        const isExpanded = existing?.isExpanded || false;
        
        return {
            ...vm,
            formattedDuration: formatDuration(vm.audioRecordingDurationSeconds),
            formattedDate: formatDate(vm.createdDate),
            relativeTime: getRelativeTime(vm.createDate),
            isLoading: existing?.isLoading || false,
            audioUrl: existing?.audioUrl || null,
            audioElementId: `audio-${vm.id}`,
            read: vm.read || false,
            cardClass: getCardClass(vm.read, isExpanded),
            callerClass: vm.read ? 'read-text' : 'unread-text',
            readMenuLabel: vm.read ? 'Mark as Unread' : 'Mark as Read',
            note: vm.note || '',
            isEditing: existing?.isEditing || false,
            isExpanded: isExpanded,
            originalNote: vm.note || '',
            showMenu: false,
            fullCallerAddress: callerAddress.length > 15 ? callerAddress.substring(0, 15) + '...' : callerAddress,
            phoneNumber: extractPhoneNumber(callerAddress)
        };
    }
}
