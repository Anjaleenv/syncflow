import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
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

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class BoardGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // In-memory stores
  private roomElements: Map<string, Map<string, ElementData>> = new Map();
  private roomConnectors: Map<string, Map<string, ConnectorData>> = new Map();
  // roomId -> Map<elementId, LockData>
  private roomLocks: Map<string, Map<string, LockData>> = new Map();
  // socketId -> { roomId, userId }
  private socketUserMap: Map<string, { roomId: string; userId: string }> = new Map();

  handleConnection(client: Socket) {
    console.log(`⚡ Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
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

  @SubscribeMessage('room:join')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; user: { id?: string; name: string; color: string } },
  ) {
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

    const existingElements = Array.from(this.roomElements.get(data.roomId)!.values());
    const existingConnectors = Array.from(this.roomConnectors.get(data.roomId)!.values());
    const existingLocks = Array.from(this.roomLocks.get(data.roomId)!.values());

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

  @SubscribeMessage('cursor:move')
  handleCursorMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; cursor: CursorData },
  ) {
    client.to(data.roomId).emit('cursor:update', data.cursor);
  }

  @SubscribeMessage('cursor:hide')
  handleCursorHide(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; userId: string },
  ) {
    client.to(data.roomId).emit('cursor:remove', { userId: data.userId });
  }

  @SubscribeMessage('user:rename')
  handleUserRename(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; userId: string; newName: string },
  ) {
    client.to(data.roomId).emit('user:renamed', {
      userId: data.userId,
      newName: data.newName,
    });
  }

  @SubscribeMessage('element:move')
  handleElementMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; elementId: string; x: number; y: number },
  ) {
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

  @SubscribeMessage('element:update')
  handleElementUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; element: ElementData },
  ) {
    const room = this.roomElements.get(data.roomId);
    if (room) {
      room.set(data.element.id, data.element);
    }
    client.to(data.roomId).emit('element:sync', data.element);
  }

  @SubscribeMessage('element:delete')
  handleElementDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; elementId: string },
  ) {
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

  // Lock and Unlock Handlers
  @SubscribeMessage('element:lock')
  handleElementLock(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; lock: LockData },
  ) {
    const lockRoom = this.roomLocks.get(data.roomId);
    if (lockRoom) {
      lockRoom.set(data.lock.elementId, data.lock);
    }
    client.to(data.roomId).emit('element:locked', data.lock);
  }

  @SubscribeMessage('element:unlock')
  handleElementUnlock(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; elementId: string },
  ) {
    const lockRoom = this.roomLocks.get(data.roomId);
    if (lockRoom) {
      lockRoom.delete(data.elementId);
    }
    client.to(data.roomId).emit('element:unlocked', { elementId: data.elementId });
  }

  // Connectors
  @SubscribeMessage('connector:create')
  handleConnectorCreate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; connector: ConnectorData },
  ) {
    const connRoom = this.roomConnectors.get(data.roomId);
    if (connRoom) {
      connRoom.set(data.connector.id, data.connector);
    }
    this.server.to(data.roomId).emit('connector:sync', data.connector);
  }

  @SubscribeMessage('connector:delete')
  handleConnectorDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; connectorId: string },
  ) {
    const connRoom = this.roomConnectors.get(data.roomId);
    if (connRoom) {
      connRoom.delete(data.connectorId);
    }
    client.to(data.roomId).emit('connector:removed', data.connectorId);
  }

  @SubscribeMessage('reaction:send')
  handleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; reaction: ReactionData },
  ) {
    this.server.to(data.roomId).emit('reaction:burst', data.reaction);
  }
}