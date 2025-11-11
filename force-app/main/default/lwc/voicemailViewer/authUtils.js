/**
 * Authentication utilities for Genesys Cloud OAuth
 */

export function generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode.apply(null, array))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

export async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

export async function exchangeCodeForToken(authCode, clientId, region) {
    try {
        const codeVerifier = sessionStorage.getItem('pkce_code_verifier');
        if (!codeVerifier) {
            throw new Error('Code verifier not found');
        }
        
        const tokenResponse = await fetch(`https://login.${region}/oauth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: clientId,
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
        return null;
    }
}

export function getAccessToken() {
    const token = localStorage.getItem('genesyscloud_access_token');
    const expiration = localStorage.getItem('genesyscloud_token_expiration');

    if (token && expiration) {
        const now = Date.now();
        if (now < parseInt(expiration, 10)) {
            return token;
        }
        localStorage.removeItem('genesyscloud_access_token');
        localStorage.removeItem('genesyscloud_token_expiration');
    }
    return null;
}
