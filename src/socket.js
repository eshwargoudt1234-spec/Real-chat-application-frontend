import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

export function createSocket(token, h) {          // h = your handler functions
  const client = new Client({
    webSocketFactory: () => new SockJS(import.meta.env.VITE_API_URL + '/ws'),
    connectHeaders: { Authorization: `Bearer ${token}` },   // JWT checked by the backend
    reconnectDelay: 3000,
    onConnect: () => {
      client.subscribe('/user/queue/messages', f => h.onMessage(JSON.parse(f.body)));
      client.subscribe('/user/queue/receipts', f => h.onReceipt(JSON.parse(f.body)));
      client.subscribe('/user/queue/typing',   f => h.onTyping(JSON.parse(f.body)));
      client.subscribe('/user/queue/errors',   f => h.onError(JSON.parse(f.body).message));
      client.subscribe('/topic/status',        f => h.onStatus(JSON.parse(f.body)));
      h.onConnected?.();
    },
    onWebSocketClose: () => h.onDisconnected?.(),
  });
  client.activate();
  return client;
}

export function sendMessage(client, receiverId, content) {
  client.publish({
    destination: '/app/chat',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ receiverId, content }),
  });
}

export function sendTyping(client, receiverId, typing) {
  client.publish({
    destination: '/app/typing',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ receiverId, typing }),
  });
}