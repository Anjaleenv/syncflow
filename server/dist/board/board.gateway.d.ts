import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
export interface ElementData {
    id: string;
    type: 'note' | 'rect' | 'circle' | 'image';
    x: number;
    y: number;
    width?: number;
    height?: number;
    content: string;
    color: string;
}
export interface ConnectorData {
    id: string;
    fromId: string;
    toId: string;
    color?: string;
}
interface CursorData {
    userId: string;
    userName: string;
    color: string;
    x: number;
    y: number;
}
interface ReactionData {
    id: string;
    userId: string;
    userName: string;
    emoji: string;
    x: number;
    y: number;
}
export interface LockData {
    elementId: string;
    userId: string;
    userName: string;
    color: string;
}
export declare class BoardGateway implements OnGatewayConnection, OnGatewayDisconnect {
    server: Server;
    private roomElements;
    private roomConnectors;
    private roomLocks;
    private socketUserMap;
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): void;
    handleJoinRoom(client: Socket, data: {
        roomId: string;
        user: {
            id?: string;
            name: string;
            color: string;
        };
    }): void;
    handleCursorMove(client: Socket, data: {
        roomId: string;
        cursor: CursorData;
    }): void;
    handleCursorHide(client: Socket, data: {
        roomId: string;
        userId: string;
    }): void;
    handleUserRename(client: Socket, data: {
        roomId: string;
        userId: string;
        newName: string;
    }): void;
    handleElementMove(client: Socket, data: {
        roomId: string;
        elementId: string;
        x: number;
        y: number;
    }): void;
    handleElementUpdate(client: Socket, data: {
        roomId: string;
        element: ElementData;
    }): void;
    handleElementDelete(client: Socket, data: {
        roomId: string;
        elementId: string;
    }): void;
    handleElementLock(client: Socket, data: {
        roomId: string;
        lock: LockData;
    }): void;
    handleElementUnlock(client: Socket, data: {
        roomId: string;
        elementId: string;
    }): void;
    handleConnectorCreate(client: Socket, data: {
        roomId: string;
        connector: ConnectorData;
    }): void;
    handleConnectorDelete(client: Socket, data: {
        roomId: string;
        connectorId: string;
    }): void;
    handleReaction(client: Socket, data: {
        roomId: string;
        reaction: ReactionData;
    }): void;
}
export {};
