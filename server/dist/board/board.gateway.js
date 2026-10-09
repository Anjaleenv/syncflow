var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { WebSocketGateway, WebSocketServer, SubscribeMessage, ConnectedSocket, MessageBody, } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
let BoardGateway = class BoardGateway {
    server;
    roomElements = new Map();
    roomConnectors = new Map();
    roomLocks = new Map();
    socketUserMap = new Map();
    handleConnection(client) {
        console.log(`⚡ Client connected: ${client.id}`);
    }
    handleDisconnect(client) {
        console.log(`❌ Client disconnected: ${client.id}`);
        const meta = this.socketUserMap.get(client.id);
        if (meta) {
            const roomLockMap = this.roomLocks.get(meta.roomId);
            if (roomLockMap) {
                for (const [elementId, lock] of roomLockMap.entries()) {
                    if (lock.userId === meta.userId) {
                        roomLockMap.delete(elementId);
                        this.server.to(meta.roomId).emit('element:unlocked', { elementId });
                    }
                }
            }
            this.socketUserMap.delete(client.id);
        }
        client.broadcast.emit('user:left', { socketId: client.id });
    }
    handleJoinRoom(client, data) {
        client.join(data.roomId);
        if (data.user.id) {
            this.socketUserMap.set(client.id, { roomId: data.roomId, userId: data.user.id });
        }
        if (!this.roomElements.has(data.roomId)) {
            this.roomElements.set(data.roomId, new Map());
        }
        if (!this.roomConnectors.has(data.roomId)) {
            this.roomConnectors.set(data.roomId, new Map());
        }
        if (!this.roomLocks.has(data.roomId)) {
            this.roomLocks.set(data.roomId, new Map());
        }
        const existingElements = Array.from(this.roomElements.get(data.roomId).values());
        const existingConnectors = Array.from(this.roomConnectors.get(data.roomId).values());
        const existingLocks = Array.from(this.roomLocks.get(data.roomId).values());
        client.emit('room:init', {
            elements: existingElements,
            connectors: existingConnectors,
            locks: existingLocks,
        });
        client.to(data.roomId).emit('user:joined', {
            socketId: client.id,
            user: data.user,
        });
    }
    handleCursorMove(client, data) {
        client.to(data.roomId).emit('cursor:update', data.cursor);
    }
    handleCursorHide(client, data) {
        client.to(data.roomId).emit('cursor:remove', { userId: data.userId });
    }
    handleUserRename(client, data) {
        client.to(data.roomId).emit('user:renamed', {
            userId: data.userId,
            newName: data.newName,
        });
    }
    handleElementMove(client, data) {
        const room = this.roomElements.get(data.roomId);
        if (room) {
            const existing = room.get(data.elementId);
            if (existing) {
                existing.x = data.x;
                existing.y = data.y;
            }
        }
        client.to(data.roomId).emit('element:moved', {
            elementId: data.elementId,
            x: data.x,
            y: data.y,
        });
    }
    handleElementUpdate(client, data) {
        const room = this.roomElements.get(data.roomId);
        if (room) {
            room.set(data.element.id, data.element);
        }
        client.to(data.roomId).emit('element:sync', data.element);
    }
    handleElementDelete(client, data) {
        const room = this.roomElements.get(data.roomId);
        if (room) {
            room.delete(data.elementId);
        }
        const connRoom = this.roomConnectors.get(data.roomId);
        if (connRoom) {
            for (const [connId, conn] of connRoom.entries()) {
                if (conn.fromId === data.elementId || conn.toId === data.elementId) {
                    connRoom.delete(connId);
                    this.server.to(data.roomId).emit('connector:removed', connId);
                }
            }
        }
        const lockRoom = this.roomLocks.get(data.roomId);
        if (lockRoom) {
            lockRoom.delete(data.elementId);
            this.server.to(data.roomId).emit('element:unlocked', { elementId: data.elementId });
        }
        client.to(data.roomId).emit('element:removed', data.elementId);
    }
    handleElementLock(client, data) {
        const lockRoom = this.roomLocks.get(data.roomId);
        if (lockRoom) {
            lockRoom.set(data.lock.elementId, data.lock);
        }
        client.to(data.roomId).emit('element:locked', data.lock);
    }
    handleElementUnlock(client, data) {
        const lockRoom = this.roomLocks.get(data.roomId);
        if (lockRoom) {
            lockRoom.delete(data.elementId);
        }
        client.to(data.roomId).emit('element:unlocked', { elementId: data.elementId });
    }
    handleConnectorCreate(client, data) {
        const connRoom = this.roomConnectors.get(data.roomId);
        if (connRoom) {
            connRoom.set(data.connector.id, data.connector);
        }
        this.server.to(data.roomId).emit('connector:sync', data.connector);
    }
    handleConnectorDelete(client, data) {
        const connRoom = this.roomConnectors.get(data.roomId);
        if (connRoom) {
            connRoom.delete(data.connectorId);
        }
        client.to(data.roomId).emit('connector:removed', data.connectorId);
    }
    handleReaction(client, data) {
        this.server.to(data.roomId).emit('reaction:burst', data.reaction);
    }
};
__decorate([
    WebSocketServer(),
    __metadata("design:type", Server)
], BoardGateway.prototype, "server", void 0);
__decorate([
    SubscribeMessage('room:join'),
    __param(0, ConnectedSocket()),
    __param(1, MessageBody()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleJoinRoom", null);
__decorate([
    SubscribeMessage('cursor:move'),
    __param(0, ConnectedSocket()),
    __param(1, MessageBody()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleCursorMove", null);
__decorate([
    SubscribeMessage('cursor:hide'),
    __param(0, ConnectedSocket()),
    __param(1, MessageBody()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleCursorHide", null);
__decorate([
    SubscribeMessage('user:rename'),
    __param(0, ConnectedSocket()),
    __param(1, MessageBody()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleUserRename", null);
__decorate([
    SubscribeMessage('element:move'),
    __param(0, ConnectedSocket()),
    __param(1, MessageBody()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleElementMove", null);
__decorate([
    SubscribeMessage('element:update'),
    __param(0, ConnectedSocket()),
    __param(1, MessageBody()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleElementUpdate", null);
__decorate([
    SubscribeMessage('element:delete'),
    __param(0, ConnectedSocket()),
    __param(1, MessageBody()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleElementDelete", null);
__decorate([
    SubscribeMessage('element:lock'),
    __param(0, ConnectedSocket()),
    __param(1, MessageBody()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleElementLock", null);
__decorate([
    SubscribeMessage('element:unlock'),
    __param(0, ConnectedSocket()),
    __param(1, MessageBody()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleElementUnlock", null);
__decorate([
    SubscribeMessage('connector:create'),
    __param(0, ConnectedSocket()),
    __param(1, MessageBody()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleConnectorCreate", null);
__decorate([
    SubscribeMessage('connector:delete'),
    __param(0, ConnectedSocket()),
    __param(1, MessageBody()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleConnectorDelete", null);
__decorate([
    SubscribeMessage('reaction:send'),
    __param(0, ConnectedSocket()),
    __param(1, MessageBody()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Socket, Object]),
    __metadata("design:returntype", void 0)
], BoardGateway.prototype, "handleReaction", null);
BoardGateway = __decorate([
    WebSocketGateway({
        cors: {
            origin: '*',
        },
    })
], BoardGateway);
export { BoardGateway };
//# sourceMappingURL=board.gateway.js.map