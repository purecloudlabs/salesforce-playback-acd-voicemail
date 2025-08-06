import { LightningElement, track, api, wire } from 'lwc';
import { getRecord } from 'lightning/uiRecordApi';
import VendorCallKey from '@salesforce/schema/VoiceCall.VendorCallKey';
import CallType from '@salesforce/schema/VoiceCall.CallType';

export default class AcdVoicemailViewer extends LightningElement {
    @api recordId;
    @track conversationId = '';
    @track CallType;
    @track audioUrl = null;
    @track errorMessage = null;
    @track isLoading = false;
    @track isAuthenticated = false;
    @track hasVoicemail = false;
    
    // Configurable properties
    @api genesysCloudRegion = 'mypurecloud.com';
    @api genesysCloudClientId;
    
    get shouldShowCard() {
        return this.CallType=="Callback" && (!this.isAuthenticated || this.hasVoicemail);
    }
    
    @wire(getRecord, { recordId: '$recordId', fields: [VendorCallKey, CallType] })
    wiredVoiceCall(result) {
        this.VoiceCall = result;
        if (result.data) {
            this.CallType = result.data.fields.CallType.value;
            
            if (this.isAuthenticated && this.CallType === 'Callback') {
                this.conversationId = this.parseValueBetweenColons(result.data.fields.VendorCallKey.value);
                // Add a two-second pause before retrieving voicemail
                setTimeout(() => {
                    this.handleRetrieveVoicemail();
                }, 2000);
            }
        }
    }
    
    connectedCallback() {
        // Check if we have a token already
        const accessToken = this.getAccessToken();
        this.isAuthenticated = !!accessToken;
    }
    
    setupAuthListener() {
        // Create event listener for message from popup
        window.addEventListener('message', (event) => {
            // Verify origin for security
            if (event.origin === window.location.origin) {
                try {
                    const data = event.data;
                    if (data && data.type === 'GENESYS_AUTH_CALLBACK' && data.accessToken) {
                        // Store the token
                        localStorage.setItem('genesyscloud_access_token', data.accessToken);
                        
                        // Calculate and store expiration time
                        const expirationTime = Date.now() + (parseInt(data.expiresIn, 10) * 1000);
                        localStorage.setItem('genesyscloud_token_expiration', expirationTime.toString());
                        
                        this.isAuthenticated = true;
                        
                        // If we have conversation ID, retrieve the voicemail after a delay
                        if (this.VoiceCall && this.VoiceCall.data && this.CallType === 'Callback') {
                            this.conversationId = this.parseValueBetweenColons(this.VoiceCall.data.fields.VendorCallKey.value);
                            setTimeout(() => {
                                this.handleRetrieveVoicemail();
                            }, 2000);
                        }
                    }
                } catch (error) {
                    console.error('Error processing auth callback message:', error);
                    this.errorMessage = 'Failed to complete authentication';
                }
            }
        });
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
    
    handleLogin() {
        // Initiate the implicit grant flow in a popup
        const redirectUri = encodeURIComponent(window.location.origin + '/resource/GenesysAuthCallback');
        console.log('Redirect URI:', redirectUri);
        const authUrl = `https://login.${this.genesysCloudRegion}/oauth/authorize` +
            `?client_id=${this.genesysCloudClientId}` +
            `&response_type=token` +
            `&redirect_uri=${redirectUri}` +
            `&scope=conversations voicemail`;
        
        // Open popup window
        const width = 600;
        const height = 700;
        const left = (screen.width/2)-(width/2);
        const top = (screen.height/2)-(height/2);
        
        const authWindow = window.open(
            authUrl,
            'GenesysCloudAuth', 
            `width=${width},height=${height},left=${left},top=${top}`
        );
        
        // Set up message listener for the popup response
        this.setupAuthListener();
        
        // Fallback if popup is blocked
        if (!authWindow || authWindow.closed || typeof authWindow.closed === 'undefined') {
            this.errorMessage = 'Popup blocked. Please allow popups for this site.';
        }
    }

    handleConversationIdChange(event) {
        this.conversationId = this.parseValueBetweenColons(this.VoiceCall.data.fields.VendorCallKey.value);
    }

    async handleRetrieveVoicemail() {
        if (this.hasVoicemail)
            return;
        
        if (!this.VoiceCall) {
            this.errorMessage = 'No voice call wired';
            return;
        }

        if (this.VoiceCall.data.fields.VendorCallKey)
            this.conversationId = this.parseValueBetweenColons(this.VoiceCall.data.fields.VendorCallKey.value);

        if (!this.conversationId) {
            this.errorMessage = 'No Conversation ID found in this record';
            return;
        }

        try {
            this.isLoading = true;
            this.errorMessage = null;
            this.audioUrl = null;

            // Get the cached token from browser storage
            const accessToken = this.getAccessToken();
            if (!accessToken) {
                // Trigger login flow if no token
                this.handleLogin();
                return;
            }

            // Step 1: Get voicemail ID from conversation
            const conversationResponse = await this.callGenesysCloudApi(
                `/api/v2/conversations/callbacks/${this.conversationId}`,
                'GET',
                null,
                accessToken
            );

            if (!conversationResponse || !conversationResponse.participants[0].voicemail.id) {
                throw new Error('No voicemail found for this conversation');
            }

            const voicemailId = conversationResponse.participants[0].voicemail.id;

            // Step 3: Get media URL
            const mediaResponse = await this.callGenesysCloudApi(
                `/api/v2/voicemail/messages/${voicemailId}/media?formatId=WAV`,
                'GET',
                null,
                accessToken
            );

            if (!mediaResponse || !mediaResponse.mediaFileUri) {
                throw new Error('Failed to retrieve voicemail audio');
            }

            this.audioUrl = mediaResponse.mediaFileUri;
            this.hasVoicemail = true;
        } catch (error) {
            // Check if error is due to invalid token
            if (error.message && error.message.includes('401')) {
                localStorage.removeItem('genesyscloud_access_token');
                localStorage.removeItem('genesyscloud_token_expiration');
                this.isAuthenticated = false;
                this.handleLogin();
                return;
            }
            
            this.errorMessage = error.message || 'An error occurred while retrieving the voicemail';
            console.error('Voicemail retrieval error:', error);
        } finally {
            this.isLoading = false;
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

    formatDuration(durationMs) {
        if (!durationMs) return 'Unknown';
        
        const seconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    
    parseValueBetweenColons(inputString) {
        if (!inputString) return null;
        
        const firstColonIndex = inputString.indexOf(':');
        if (firstColonIndex === -1) return null;
        
        const secondColonIndex = inputString.indexOf(':', firstColonIndex + 1);
        if (secondColonIndex === -1) return null;
        
        return inputString.substring(firstColonIndex + 1, secondColonIndex);
    }
}