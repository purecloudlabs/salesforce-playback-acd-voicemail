/**
 * WebSocket utilities for real-time notifications
 */

import { callGenesysCloudApi } from './apiUtils';

export async function setupWebSocket(accessToken, region, onMessage, onConnectionChange) {
    try {
        if (!accessToken) {
            console.log('No access token for WebSocket');
            return null;
        }

        console.log('Setting up WebSocket notifications...');

        const userResponse = await callGenesysCloudApi('/api/v2/users/me', 'GET', null, accessToken, region);
        const userId = userResponse.id;

        const channelResponse = await callGenesysCloudApi(
            '/api/v2/notifications/channels',
            'POST',
            {},
            accessToken,
            region
        );

        const channelId = channelResponse.id;
        const wsUri = channelResponse.connectUri;
        const topic = `v2.users.${userId}.voicemail.messages`;

        console.log('Subscribing to:', topic);

        await callGenesysCloudApi(
            `/api/v2/notifications/channels/${channelId}/subscriptions`,
            'POST',
            [{ id: topic }],
            accessToken,
            region
        );

        console.log('Subscription successful');

        const websocket = new WebSocket(wsUri);

        websocket.onopen = () => {
            onConnectionChange(true);
            console.log('✅ WebSocket connected - Real-time updates active');
        };

        websocket.onmessage = (event) => {
            console.log('WebSocket message:', event.data);
            const message = JSON.parse(event.data);
            if (message.topicName && message.topicName.includes('voicemail.messages')) {
                console.log('Voicemail event detected, refreshing...');
                onMessage(message);
            }
        };

        websocket.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            onConnectionChange(false);
        };

        websocket.onclose = (event) => {
            console.log('WebSocket closed:', event.code, event.reason);
            onConnectionChange(false);
        };

        return { websocket, channelId };
    } catch (error) {
        console.error('❌ WebSocket setup failed:', error);
        return null;
    }
}

export function closeWebSocket(websocket) {
    if (websocket) {
        websocket.close();
    }
}
