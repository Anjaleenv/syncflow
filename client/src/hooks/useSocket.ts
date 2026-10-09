'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_SERVER_URL = 'http://localhost:3000'; // NestJS default port

export const useSocket = (roomId: string, user: { name: string; color: string }) => {
    const socketRef = useRef<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        // Initialize socket connection
        const socket = io(SOCKET_SERVER_URL, {
            transports: ['websocket'],
        });
        socketRef.current = socket;

        socket.on('connect', () => {
            setIsConnected(true);
            socket.emit('room:join', { roomId, user });
        });

        socket.on('disconnect', () => {
            setIsConnected(false);
        });

        return () => {
            socket.disconnect();
        };
    }, [roomId, user.name, user.color]);

    return { socket: socketRef.current, isConnected };
};