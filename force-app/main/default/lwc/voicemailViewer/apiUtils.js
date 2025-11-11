/**
 * API utilities for Genesys Cloud API calls
 */

export async function callGenesysCloudApi(endpoint, method, body, accessToken, region) {
    try {
        const url = `https://api.${region}` + endpoint;
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

export async function markVoicemailAsRead(voicemailId, accessToken, region) {
    try {
        await callGenesysCloudApi(
            `/api/v2/voicemail/messages/${voicemailId}`,
            'PUT',
            { read: true },
            accessToken,
            region
        );
    } catch (error) {
        console.error('Failed to mark voicemail as read:', error);
    }
}
