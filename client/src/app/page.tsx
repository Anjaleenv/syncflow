'use client';

import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { toPng } from 'html-to-image';
import {
  MousePointer2,
  StickyNote,
  Square,
  Circle as CircleIcon,
  Image as ImageIcon,
  Trash2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Smile,
  Sparkles,
  Pencil,
  Check,
  X,
  ArrowRight,
  Sun,
  Moon,
  Download,
} from 'lucide-react';

export type ElementType = 'note' | 'rect' | 'circle' | 'image';

export interface BoardElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  content: string;
  color: string;
}

export interface Connector {
  id: string;
  fromId: string;
  toId: string;
  color?: string;
}

interface Cursor {
  userId: string;
  userName: string;
  color: string;
  x: number;
  y: number;
}

interface Reaction {
  id: string;
  userId: string;
  userName: string;
  emoji: string;
  x: number;
  y: number;
}

interface AlignmentGuide {
  orientation: 'horizontal' | 'vertical';
  pos: number;
}

// 8 Figma-style Resize Handles (Corners + Sides)
type ResizeHandle =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left';

const CURSOR_COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
const EMOJIS = ['🔥', '❤️', '👍', '🚀', '🎉', '👀', '✨', '💯'];
const PALETTE = [
  { name: 'Yellow', bg: '#fef08a' },
  { name: 'Mint', bg: '#bbf7d0' },
  { name: 'Orange', bg: '#fed7aa' },
  { name: 'Purple', bg: '#e9d5ff' },
  { name: 'Blue', bg: '#bae6fd' },
];

const StaticImageContent = memo(function StaticImageContent({ src }: { src: string }) {
  return (
    <div className="w-full h-full rounded-xl overflow-hidden pointer-events-none select-none flex items-center justify-center bg-transparent">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Board upload"
        decoding="sync"
        loading="eager"
        draggable={false}
        className="w-full h-full object-contain pointer-events-none select-none"
        style={{ WebkitUserDrag: 'none', backfaceVisibility: 'hidden', transform: 'translateZ(0)' } as React.CSSProperties}
      />
    </div>
  );
});

export default function CanvasPage() {
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; color: string } | null>(null);

  // Theme mode with localStorage persistence
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const canvasViewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem('syncflow_theme');
    if (savedTheme !== null) {
      setIsDarkMode(savedTheme === 'dark');
    }
  }, []);

  const toggleTheme = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem('syncflow_theme', next ? 'dark' : 'light');
      return next;
    });
  };

  // Name edit state
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState('');
  const [remainingEdits, setRemainingEdits] = useState(3);

  // Selected element for resizing / controls
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  // Smart Alignment Guides State
  const [activeGuides, setActiveGuides] = useState<AlignmentGuide[]>([]);

  // Connecting Mode State
  const [isConnectingMode, setIsConnectingMode] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [mouseWorldPos, setMouseWorldPos] = useState({ x: 0, y: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const randomId = Math.random().toString(36).substring(2, 7);
    const randomColor = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
    const initialName = `User-${randomId}`;
    setCurrentUser({
      id: randomId,
      name: initialName,
      color: randomColor,
    });
    setTempName(initialName);
  }, []);

  const roomId = 'main-room';
  const { socket, isConnected } = useSocket(
    roomId,
    currentUser || { name: 'Connecting', color: '#999' }
  );

  const [remoteCursors, setRemoteCursors] = useState<Record<string, Cursor>>({});
  const [elements, setElements] = useState<BoardElement[]>([]);
  const elementsRef = useRef<BoardElement[]>([]);
  elementsRef.current = elements;

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  // Viewport Pan & Zoom State
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  // Dragging Element State
  const [draggingElementId, setDraggingElementId] = useState<string | null>(null);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentDragPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Resizing State
  const resizingRef = useRef<{
    elementId: string;
    handle: ResizeHandle;
    initialX: number;
    initialY: number;
    initialWidth: number;
    initialHeight: number;
    initialMouseX: number;
    initialMouseY: number;
  } | null>(null);

  const lastCursorEmit = useRef(0);
  const lastDragEmit = useRef(0);
  const isDraggingRef = useRef(false);
  const isResizingRef = useRef(false);
  const animationFrameId = useRef<number | null>(null);

  // Direct DOM references for zero-flicker remote transforms
  const elementDomRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Convert Screen Coordinates (px) to Canvas World Coordinates
  const toWorldCoords = useCallback((clientX: number, clientY: number) => ({
    x: (clientX - pan.x) / zoom,
    y: (clientY - pan.y) / zoom,
  }), [pan.x, pan.y, zoom]);

  const getElementDimensions = (el: BoardElement) => {
    const w = el.width || (el.type === 'circle' ? 140 : el.type === 'rect' ? 180 : el.type === 'image' ? 260 : 220);
    const h = el.height || (el.type === 'circle' ? 140 : el.type === 'rect' ? 110 : el.type === 'image' ? 200 : 200);
    return { w, h };
  };

  const getElementCenter = (el: BoardElement) => {
    const { w, h } = getElementDimensions(el);
    return {
      x: el.x + w / 2,
      y: el.y + h / 2,
    };
  };

  const hideMyCursor = () => {
    if (socket && isConnected && currentUser) {
      socket.emit('cursor:hide', { roomId, userId: currentUser.id });
    }
  };

  // Export Canvas as PNG
  const handleExportPNG = async () => {
    if (!canvasViewportRef.current || elements.length === 0) return;
    try {
      setIsExporting(true);
      setSelectedElementId(null);
      setActiveGuides([]);

      // 1. Calculate bounding box of all content
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      elements.forEach((el) => {
        const { w, h } = getElementDimensions(el);
        if (el.x < minX) minX = el.x;
        if (el.y < minY) minY = el.y;
        if (el.x + w > maxX) maxX = el.x + w;
        if (el.y + h > maxY) maxY = el.y + h;
      });

      // Include connectors in the bounding box
      connectors.forEach((conn) => {
        const fromEl = elements.find((e) => e.id === conn.fromId);
        const toEl = elements.find((e) => e.id === conn.toId);
        if (fromEl && toEl) {
          const fc = getElementCenter(fromEl);
          const tc = getElementCenter(toEl);
          minX = Math.min(minX, fc.x, tc.x);
          minY = Math.min(minY, fc.y, tc.y);
          maxX = Math.max(maxX, fc.x, tc.x);
          maxY = Math.max(maxY, fc.y, tc.y);
        }
      });

      const padding = 50; // Clean frame border
      const cropX = minX - padding;
      const cropY = minY - padding;
      const cropWidth = maxX - minX + padding * 2;
      const cropHeight = maxY - minY + padding * 2;

      // Allow UI outlines & guides to clear
      await new Promise((r) => setTimeout(r, 60));

      const dataUrl = await toPng(canvasViewportRef.current, {
        cacheBust: true,
        backgroundColor: isDarkMode ? '#121214' : '#f8fafc',
        width: cropWidth,
        height: cropHeight,
        style: {
          transform: `translate(${-cropX}px, ${-cropY}px) scale(1)`,
          transformOrigin: 'top left',
          width: `${cropWidth}px`,
          height: `${cropHeight}px`,
        },
        filter: (node) => {
          if (node instanceof HTMLElement) {
            if (
              node.classList.contains('resize-handle') ||
              node.classList.contains('remote-cursor') ||
              node.classList.contains('emoji-burst')
            ) {
              return false;
            }
          }
          return true;
        },
      });

      const link = document.createElement('a');
      link.download = `syncflow-canvas-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Failed to export canvas:', err);
    } finally {
      setIsExporting(false);
    }
  };

// Image Optimizer
const addImageElement = (dataUrl: string, targetX?: number, targetY?: number) => {
  const img = new Image();
  img.src = dataUrl;
  img.onload = () => {
    const maxDim = 500;
    let targetWidth = img.width;
    let targetHeight = img.height;

    if (targetWidth > maxDim || targetHeight > maxDim) {
      if (targetWidth > targetHeight) {
        targetHeight = Math.round((targetHeight * maxDim) / targetWidth);
        targetWidth = maxDim;
      } else {
        targetWidth = Math.round((targetWidth * maxDim) / targetHeight);
        targetHeight = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    }
    const optimizedUrl = canvas.toDataURL('image/jpeg', 0.8);

    const displayMaxWidth = 260;
    const scale = targetWidth > displayMaxWidth ? displayMaxWidth / targetWidth : 1;
    const width = Math.round(targetWidth * scale);
    const height = Math.round(targetHeight * scale);

    const defaultCenter = toWorldCoords(window.innerWidth / 2, window.innerHeight / 2);
    const posX = targetX !== undefined ? targetX - width / 2 : defaultCenter.x - width / 2;
    const posY = targetY !== undefined ? targetY - height / 2 : defaultCenter.y - height / 2;

    const newElement: BoardElement = {
      id: Math.random().toString(36).substring(2, 9),
      type: 'image',
      x: isNaN(posX) ? 100 : posX,
      y: isNaN(posY) ? 100 : posY,
      width,
      height,
      content: optimizedUrl,
      color: '#ffffff',
    };

    setElements((prev) => [...prev, newElement]);
    setSelectedElementId(newElement.id);
    if (socket && isConnected) {
      socket.emit('element:update', { roomId, element: newElement });
    }
  };
};

const processImageFile = (file: File, worldCoords?: { x: number; y: number }) => {
  if (!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target?.result as string;
    if (dataUrl) {
      addImageElement(dataUrl, worldCoords?.x, worldCoords?.y);
    }
  };
  reader.readAsDataURL(file);
};

const handleDrop = (e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
  const files = e.dataTransfer.files;
  if (files && files.length > 0) {
    const world = toWorldCoords(e.clientX, e.clientY);
    Array.from(files).forEach((file) => processImageFile(file, world));
  }
};

const handleDragOver = (e: React.DragEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

useEffect(() => {
  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          processImageFile(file);
        }
      }
    }
  };

  window.addEventListener('paste', handlePaste);
  return () => window.removeEventListener('paste', handlePaste);
}, [pan, zoom]);

useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'input') return;
    if (e.key.toLowerCase() === 'e') {
      setShowEmojiPicker((prev) => !prev);
    }
    if (e.key.toLowerCase() === 'c') {
      setIsConnectingMode((prev) => {
        if (prev) setConnectSourceId(null);
        return !prev;
      });
    }
    if (e.key === 'Escape') {
      setIsConnectingMode(false);
      setConnectSourceId(null);
      setSelectedElementId(null);
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);

// Socket event listeners
useEffect(() => {
  if (!socket) return;

  socket.on('room:init', ({ elements, connectors }: { elements: BoardElement[]; connectors?: Connector[] }) => {
    setElements(elements || []);
    setConnectors(connectors || []);
  });

  socket.on('cursor:update', (cursor: Cursor) => {
    setRemoteCursors((prev) => ({
      ...prev,
      [cursor.userId]: cursor,
    }));
  });

  socket.on('cursor:remove', ({ userId }: { userId: string }) => {
    setRemoteCursors((prev) => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  });

  socket.on('user:left', ({ socketId }: { socketId: string }) => {
    setRemoteCursors((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  });

  socket.on('user:renamed', ({ userId, newName }: { userId: string; newName: string }) => {
    setRemoteCursors((prev) => {
      if (!prev[userId]) return prev;
      return {
        ...prev,
        [userId]: {
          ...prev[userId],
          userName: newName,
        },
      };
    });
  });

  socket.on('element:moved', ({ elementId, x, y }: { elementId: string; x: number; y: number }) => {
    const domEl = elementDomRefs.current.get(elementId);
    if (domEl) {
      domEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }

    const target = elementsRef.current.find((e) => e.id === elementId);
    if (target) {
      target.x = x;
      target.y = y;
    }
  });

  socket.on('element:sync', (updatedElement: BoardElement) => {
    setElements((prev) => {
      const exists = prev.some((el) => el.id === updatedElement.id);
      if (exists) {
        return prev.map((el) => (el.id === updatedElement.id ? updatedElement : el));
      }
      return [...prev, updatedElement];
    });

    const domEl = elementDomRefs.current.get(updatedElement.id);
    if (domEl) {
      domEl.style.transform = `translate3d(${updatedElement.x}px, ${updatedElement.y}px, 0)`;
    }
  });

  socket.on('element:removed', (deletedId: string) => {
    setElements((prev) => prev.filter((el) => el.id !== deletedId));
    setConnectors((prev) => prev.filter((c) => c.fromId !== deletedId && c.toId !== deletedId));
    elementDomRefs.current.delete(deletedId);
    setSelectedElementId((curr) => (curr === deletedId ? null : curr));
  });

  socket.on('connector:sync', (newConn: Connector) => {
    setConnectors((prev) => {
      const exists = prev.some((c) => c.id === newConn.id);
      if (exists) return prev;
      return [...prev, newConn];
    });
  });

  socket.on('connector:removed', (deletedConnId: string) => {
    setConnectors((prev) => prev.filter((c) => c.id !== deletedConnId));
  });

  socket.on('reaction:burst', (reaction: Reaction) => {
    setReactions((prev) => [...prev, reaction]);
    setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== reaction.id));
    }, 1800);
  });

  return () => {
    socket.off('room:init');
    socket.off('cursor:update');
    socket.off('cursor:remove');
    socket.off('user:left');
    socket.off('user:renamed');
    socket.off('element:moved');
    socket.off('element:sync');
    socket.off('element:removed');
    socket.off('connector:sync');
    socket.off('connector:removed');
    socket.off('reaction:burst');
  };
}, [socket]);

const handleSaveName = () => {
  if (!currentUser || remainingEdits <= 0) return;
  const trimmed = tempName.trim();
  if (!trimmed || trimmed === currentUser.name) {
    setIsEditingName(false);
    return;
  }

  const updatedUser = { ...currentUser, name: trimmed };
  setCurrentUser(updatedUser);
  setRemainingEdits((prev) => prev - 1);
  setIsEditingName(false);

  if (socket && isConnected) {
    socket.emit('user:rename', {
      roomId,
      userId: currentUser.id,
      newName: trimmed,
    });
  }
};

const handleWheel = (e: React.WheelEvent) => {
  e.preventDefault();
  const zoomFactor = 1.1;
  const newZoom = e.deltaY < 0 ? Math.min(zoom * zoomFactor, 2.5) : Math.max(zoom / zoomFactor, 0.4);

  const mouseX = e.clientX;
  const mouseY = e.clientY;

  setPan({
    x: mouseX - (mouseX - pan.x) * (newZoom / zoom),
    y: mouseY - (mouseY - pan.y) * (newZoom / zoom),
  });
  setZoom(newZoom);
};

const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    e.preventDefault();
    setIsPanning(true);
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    return;
  }

  if ((e.target as HTMLElement).classList.contains('canvas-background')) {
    setSelectedElementId(null);
  }
};

// Start Resizing Handle Handler (Corners & Sides)
const handleResizeStart = (e: React.MouseEvent, element: BoardElement, handle: ResizeHandle) => {
  e.stopPropagation();
  e.preventDefault();

  const world = toWorldCoords(e.clientX, e.clientY);
  const { w, h } = getElementDimensions(element);

  isResizingRef.current = true;
  resizingRef.current = {
    elementId: element.id,
    handle,
    initialX: element.x,
    initialY: element.y,
    initialWidth: w,
    initialHeight: h,
    initialMouseX: world.x,
    initialMouseY: world.y,
  };
};

const calculateSnapping = (targetId: string, testX: number, testY: number) => {
  const currentEl = elements.find((el) => el.id === targetId);
  if (!currentEl) return { snappedX: testX, snappedY: testY, guides: [] };

  const { w, h } = getElementDimensions(currentEl);
  const curLeft = testX;
  const curCenterX = testX + w / 2;
  const curRight = testX + w;

  const curTop = testY;
  const curCenterY = testY + h / 2;
  const curBottom = testY + h;

  const SNAP_DIST = 6 / zoom;
  let snappedX = testX;
  let snappedY = testY;
  const guides: AlignmentGuide[] = [];

  let minDiffX = Infinity;
  let minDiffY = Infinity;

  for (const other of elements) {
    if (other.id === targetId) continue;
    const { w: oW, h: oH } = getElementDimensions(other);
    const oLeft = other.x;
    const oCenterX = other.x + oW / 2;
    const oRight = other.x + oW;

    const oTop = other.y;
    const oCenterY = other.y + oH / 2;
    const oBottom = other.y + oH;

    const xAlignments = [
      { test: curLeft, target: oLeft, offset: 0, guideX: oLeft },
      { test: curCenterX, target: oCenterX, offset: w / 2, guideX: oCenterX },
      { test: curRight, target: oRight, offset: w, guideX: oRight },
      { test: curLeft, target: oRight, offset: 0, guideX: oRight },
      { test: curRight, target: oLeft, offset: w, guideX: oLeft },
    ];

    for (const item of xAlignments) {
      const diff = Math.abs(item.test - item.target);
      if (diff < SNAP_DIST && diff < minDiffX) {
        minDiffX = diff;
        snappedX = item.target - item.offset;
        guides.push({ orientation: 'vertical', pos: item.guideX });
      }
    }

    const yAlignments = [
      { test: curTop, target: oTop, offset: 0, guideY: oTop },
      { test: curCenterY, target: oCenterY, offset: h / 2, guideY: oCenterY },
      { test: curBottom, target: oBottom, offset: h, guideY: oBottom },
      { test: curTop, target: oBottom, offset: 0, guideY: oBottom },
      { test: curBottom, target: oTop, offset: h, guideY: oTop },
    ];

    for (const item of yAlignments) {
      const diff = Math.abs(item.test - item.target);
      if (diff < SNAP_DIST && diff < minDiffY) {
        minDiffY = diff;
        snappedY = item.target - item.offset;
        guides.push({ orientation: 'horizontal', pos: item.guideY });
      }
    }
  }

  return { snappedX, snappedY, guides };
};

const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
  if (isPanning) {
    setPan({
      x: e.clientX - panStart.current.x,
      y: e.clientY - panStart.current.y,
    });
    return;
  }

  const world = toWorldCoords(e.clientX, e.clientY);

  if (isConnectingMode && connectSourceId) {
    setMouseWorldPos(world);
  }

  const now = Date.now();

  // 1. Cursor broadcast
  if (now - lastCursorEmit.current > 40 && socket && isConnected && currentUser) {
    lastCursorEmit.current = now;
    socket.emit('cursor:move', {
      roomId,
      cursor: {
        userId: currentUser.id,
        userName: currentUser.name,
        color: currentUser.color,
        x: world.x,
        y: world.y,
      },
    });
  }

  // 2. Active Resizing (Both 4 Corners AND 4 Sides)
  if (isResizingRef.current && resizingRef.current) {
    const { elementId, handle, initialX, initialY, initialWidth, initialHeight, initialMouseX, initialMouseY } = resizingRef.current;
    const dx = world.x - initialMouseX;
    const dy = world.y - initialMouseY;

    let newWidth = initialWidth;
    let newHeight = initialHeight;
    let newX = initialX;
    let newY = initialY;

    const minSize = 60;

    switch (handle) {
      // Corners
      case 'bottom-right':
        newWidth = Math.max(minSize, initialWidth + dx);
        newHeight = Math.max(minSize, initialHeight + dy);
        break;
      case 'bottom-left':
        newWidth = Math.max(minSize, initialWidth - dx);
        newX = initialX + (initialWidth - newWidth);
        newHeight = Math.max(minSize, initialHeight + dy);
        break;
      case 'top-right':
        newWidth = Math.max(minSize, initialWidth + dx);
        newHeight = Math.max(minSize, initialHeight - dy);
        newY = initialY + (initialHeight - newHeight);
        break;
      case 'top-left':
        newWidth = Math.max(minSize, initialWidth - dx);
        newHeight = Math.max(minSize, initialHeight - dy);
        newX = initialX + (initialWidth - newWidth);
        newY = initialY + (initialHeight - newHeight);
        break;

      // Sides
      case 'right':
        newWidth = Math.max(minSize, initialWidth + dx);
        break;
      case 'left':
        newWidth = Math.max(minSize, initialWidth - dx);
        newX = initialX + (initialWidth - newWidth);
        break;
      case 'bottom':
        newHeight = Math.max(minSize, initialHeight + dy);
        break;
      case 'top':
        newHeight = Math.max(minSize, initialHeight - dy);
        newY = initialY + (initialHeight - newHeight);
        break;
    }

    setElements((prev) =>
      prev.map((el) => {
        if (el.id === elementId) {
          const updated = {
            ...el,
            x: Math.round(newX),
            y: Math.round(newY),
            width: Math.round(newWidth),
            height: Math.round(newHeight),
          };
          if (socket && isConnected && now - lastDragEmit.current > 45) {
            lastDragEmit.current = now;
            socket.emit('element:update', { roomId, element: updated });
          }
          return updated;
        }
        return el;
      })
    );
    return;
  }

  // 3. Active Local Dragging with Instant Hardware Transform
  if (draggingElementId && isDraggingRef.current) {
    const rawX = world.x - dragOffset.current.x;
    const rawY = world.y - dragOffset.current.y;

    const { snappedX, snappedY, guides } = calculateSnapping(draggingElementId, rawX, rawY);
    setActiveGuides(guides);

    currentDragPos.current = { x: snappedX, y: snappedY };

    const domEl = elementDomRefs.current.get(draggingElementId);
    if (domEl) {
      domEl.style.transform = `translate3d(${snappedX}px, ${snappedY}px, 0)`;
    }

    if (socket && isConnected && now - lastDragEmit.current > 35) {
      lastDragEmit.current = now;
      socket.emit('element:move', {
        roomId,
        elementId: draggingElementId,
        x: snappedX,
        y: snappedY,
      });
    }
  }
};

const handleMouseUp = () => {
  setIsPanning(false);
  setActiveGuides([]);

  if (animationFrameId.current) {
    cancelAnimationFrame(animationFrameId.current);
    animationFrameId.current = null;
  }

  if (isResizingRef.current && resizingRef.current) {
    const resizedEl = elements.find((el) => el.id === resizingRef.current?.elementId);
    if (resizedEl && socket && isConnected) {
      socket.emit('element:update', { roomId, element: resizedEl });
    }
    isResizingRef.current = false;
    resizingRef.current = null;
  }

  if (draggingElementId && isDraggingRef.current) {
    const finalX = currentDragPos.current.x;
    const finalY = currentDragPos.current.y;

    setElements((prev) =>
      prev.map((el) => (el.id === draggingElementId ? { ...el, x: finalX, y: finalY } : el))
    );

    const droppedEl = elements.find((el) => el.id === draggingElementId);
    if (droppedEl && socket && isConnected) {
      socket.emit('element:update', {
        roomId,
        element: { ...droppedEl, x: finalX, y: finalY },
      });
    }
  }

  setDraggingElementId(null);
  isDraggingRef.current = false;
};

const handleElementClick = (e: React.MouseEvent, element: BoardElement) => {
  e.stopPropagation();

  if (isConnectingMode) {
    if (!connectSourceId) {
      setConnectSourceId(element.id);
    } else if (connectSourceId !== element.id) {
      const newConnector: Connector = {
        id: Math.random().toString(36).substring(2, 9),
        fromId: connectSourceId,
        toId: element.id,
        color: currentUser?.color || '#3b82f6',
      };

      setConnectors((prev) => [...prev, newConnector]);
      if (socket && isConnected) {
        socket.emit('connector:create', { roomId, connector: newConnector });
      }

      setConnectSourceId(null);
      setIsConnectingMode(false);
    }
    return;
  }

  setSelectedElementId(element.id);
};

const handleMouseDownOnElement = (e: React.MouseEvent, element: BoardElement) => {
  if (isConnectingMode) return;

  const target = e.target as HTMLElement;
  if (target.tagName.toLowerCase() === 'textarea' || target.closest('button') || target.classList.contains('resize-handle')) {
    return;
  }
  e.stopPropagation();
  e.preventDefault();

  setSelectedElementId(element.id);

  const world = toWorldCoords(e.clientX, e.clientY);
  setDraggingElementId(element.id);
  isDraggingRef.current = true;
  currentDragPos.current = { x: element.x, y: element.y };
  dragOffset.current = {
    x: world.x - element.x,
    y: world.y - element.y,
  };
};

const addElement = (type: ElementType) => {
  const worldCenter = toWorldCoords(window.innerWidth / 2, window.innerHeight / 2);
  const newElement: BoardElement = {
    id: Math.random().toString(36).substring(2, 9),
    type,
    x: worldCenter.x - 100 + (Math.random() * 40 - 20),
    y: worldCenter.y - 80 + (Math.random() * 40 - 20),
    width: type === 'circle' ? 140 : type === 'rect' ? 180 : 220,
    height: type === 'circle' ? 140 : type === 'rect' ? 110 : 200,
    content: type === 'note' ? 'New sticky note...' : type === 'rect' ? 'Block Label' : 'Step 1',
    color: type === 'note' ? PALETTE[0].bg : type === 'rect' ? PALETTE[4].bg : PALETTE[1].bg,
  };

  setElements((prev) => [...prev, newElement]);
  setSelectedElementId(newElement.id);
  if (socket && isConnected) {
    socket.emit('element:update', { roomId, element: newElement });
  }
};

const updateElementContent = (id: string, content: string) => {
  setElements((prev) =>
    prev.map((el) => {
      if (el.id === id) {
        const updated = { ...el, content };
        if (socket && isConnected) {
          socket.emit('element:update', { roomId, element: updated });
        }
        return updated;
      }
      return el;
    })
  );
};

const updateElementColor = (id: string, color: string) => {
  setElements((prev) =>
    prev.map((el) => {
      if (el.id === id) {
        const updated = { ...el, color };
        if (socket && isConnected) {
          socket.emit('element:update', { roomId, element: updated });
        }
        return updated;
      }
      return el;
    })
  );
};

const deleteElement = (id: string) => {
  setElements((prev) => prev.filter((el) => el.id !== id));
  setConnectors((prev) => prev.filter((c) => c.fromId !== id && c.toId !== id));
  elementDomRefs.current.delete(id);
  if (socket && isConnected) {
    socket.emit('element:delete', { roomId, elementId: id });
  }
};

const deleteConnector = (id: string, e?: React.MouseEvent) => {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  setConnectors((prev) => prev.filter((c) => c.id !== id));
  if (socket && isConnected) {
    socket.emit('connector:delete', { roomId, connectorId: id });
  }
};

const triggerReaction = (emoji: string) => {
  if (!socket || !isConnected || !currentUser) return;

  const reaction: Reaction = {
    id: Math.random().toString(36).substring(2, 9),
    userId: currentUser.id,
    userName: currentUser.name,
    emoji,
    x: mouseWorldPos.x || 200,
    y: mouseWorldPos.y || 200,
  };

  socket.emit('reaction:send', { roomId, reaction });
  setShowEmojiPicker(false);
};

const resetView = () => {
  setPan({ x: 0, y: 0 });
  setZoom(1);
};

// Reusable 8 Figma-Style Resize Handles (Corners + Sides)
const renderResizeHandles = (element: BoardElement) => {
  if (selectedElementId !== element.id) return null;
  return (
    <>
      {/* 4 Corner Handles */}
      <div
        onMouseDown={(e) => handleResizeStart(e, element, 'top-left')}
        className="resize-handle absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-nwse-resize z-30 shadow-md hover:scale-125 transition-transform"
        title="Resize diagonally"
      />
      <div
        onMouseDown={(e) => handleResizeStart(e, element, 'top-right')}
        className="resize-handle absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-nesw-resize z-30 shadow-md hover:scale-125 transition-transform"
        title="Resize diagonally"
      />
      <div
        onMouseDown={(e) => handleResizeStart(e, element, 'bottom-left')}
        className="resize-handle absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-nesw-resize z-30 shadow-md hover:scale-125 transition-transform"
        title="Resize diagonally"
      />
      <div
        onMouseDown={(e) => handleResizeStart(e, element, 'bottom-right')}
        className="resize-handle absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-blue-500 rounded-sm cursor-nwse-resize z-30 shadow-md hover:scale-125 transition-transform"
        title="Resize diagonally"
      />

      {/* 4 Side Handles (Top, Bottom, Left, Right) */}
      <div
        onMouseDown={(e) => handleResizeStart(e, element, 'top')}
        className="resize-handle absolute -top-1.5 left-1/2 -translate-x-1/2 w-4 h-2 bg-white border-2 border-blue-500 rounded-full cursor-ns-resize z-30 shadow-md hover:scale-125 transition-transform"
        title="Resize height from top"
      />
      <div
        onMouseDown={(e) => handleResizeStart(e, element, 'bottom')}
        className="resize-handle absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-4 h-2 bg-white border-2 border-blue-500 rounded-full cursor-ns-resize z-30 shadow-md hover:scale-125 transition-transform"
        title="Resize height from bottom"
      />
      <div
        onMouseDown={(e) => handleResizeStart(e, element, 'left')}
        className="resize-handle absolute top-1/2 -translate-y-1/2 -left-1.5 w-2 h-4 bg-white border-2 border-blue-500 rounded-full cursor-ew-resize z-30 shadow-md hover:scale-125 transition-transform"
        title="Resize width from left"
      />
      <div
        onMouseDown={(e) => handleResizeStart(e, element, 'right')}
        className="resize-handle absolute top-1/2 -translate-y-1/2 -right-1.5 w-2 h-4 bg-white border-2 border-blue-500 rounded-full cursor-ew-resize z-30 shadow-md hover:scale-125 transition-transform"
        title="Resize width from right"
      />
    </>
  );
};

const sourceElement = connectSourceId ? elements.find((el) => el.id === connectSourceId) : null;
const sourceCenter = sourceElement ? getElementCenter(sourceElement) : null;

if (!currentUser) return null;

return (
  <div
    onWheel={handleWheel}
    onMouseDown={handleMouseDown}
    onMouseMove={handleMouseMove}
    onMouseUp={handleMouseUp}
    onMouseLeave={hideMyCursor}
    onDrop={handleDrop}
    onDragOver={handleDragOver}
    className={`canvas-background relative w-screen h-screen overflow-hidden select-none transition-colors duration-300 ${isDarkMode ? 'bg-[#121214]' : 'bg-[#f8fafc]'
      } ${isPanning ? 'cursor-grabbing' : isConnectingMode ? 'cursor-crosshair' : 'cursor-default'}`}
    style={{
      backgroundImage: isDarkMode
        ? 'radial-gradient(rgba(255,255,255,0.12) 1.5px, transparent 1.5px)'
        : 'radial-gradient(rgba(15,23,42,0.14) 1.5px, transparent 1.5px)',
      backgroundPosition: `${pan.x}px ${pan.y}px`,
      backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
    }}
  >
    <input
      type="file"
      ref={fileInputRef}
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) {
          processImageFile(file);
          e.target.value = '';
        }
      }}
    />

    {/* Top Left Presence & Editable Name Badge */}
    <div
      onMouseEnter={hideMyCursor}
      onMouseMove={(e) => {
        e.stopPropagation();
        hideMyCursor();
      }}
      className={`absolute top-5 left-5 z-50 flex items-center gap-2.5 backdrop-blur-md px-3.5 py-2 rounded-full shadow-2xl transition-colors duration-200 border ${isDarkMode
        ? 'bg-neutral-900/90 border-neutral-800 text-neutral-300'
        : 'bg-white/95 border-slate-200 text-slate-700 shadow-slate-200/50'
        }`}
    >
      <span
        className="w-2.5 h-2.5 rounded-full animate-pulse flex-shrink-0"
        style={{ backgroundColor: isConnected ? '#22c55e' : '#ef4444' }}
      />
      <span className="text-xs font-semibold hidden sm:inline">
        {isConnected ? 'SyncFlow Live' : 'Connecting...'}
      </span>
      <div
        className={`h-3.5 w-px mx-0.5 hidden sm:block ${isDarkMode ? 'bg-neutral-800' : 'bg-slate-300'
          }`}
      />

      {isEditingName ? (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={tempName}
            maxLength={18}
            autoFocus
            onChange={(e) => setTempName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveName();
              if (e.key === 'Escape') setIsEditingName(false);
            }}
            className={`text-xs px-2.5 py-1 rounded-md outline-none border w-28 font-medium shadow-inner ${isDarkMode
              ? 'bg-neutral-800 text-white border-blue-500/60'
              : 'bg-slate-100 text-slate-900 border-blue-500'
              }`}
          />
          <button
            onClick={handleSaveName}
            className="p-1 hover:bg-black/10 text-emerald-500 rounded-md transition-colors"
            title="Save name (Enter)"
          >
            <Check size={14} />
          </button>
          <button
            onClick={() => setIsEditingName(false)}
            className="p-1 hover:bg-black/10 text-neutral-400 hover:text-red-500 rounded-md transition-colors"
            title="Cancel (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            if (remainingEdits > 0) {
              setTempName(currentUser.name);
              setIsEditingName(true);
            }
          }}
          disabled={remainingEdits <= 0}
          className={`group flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition-all ${remainingEdits > 0 ? 'hover:brightness-110 active:scale-95 cursor-pointer' : 'cursor-not-allowed opacity-80'
            }`}
          style={{ backgroundColor: `${currentUser.color}25`, color: currentUser.color }}
          title={remainingEdits > 0 ? `Click to edit name (${remainingEdits} left)` : 'Edit limit reached (0 left)'}
        >
          <span>{currentUser.name}</span>
          {remainingEdits > 0 ? (
            <>
              <Pencil size={11} className="opacity-60 group-hover:opacity-100 transition-opacity" />
              <span className="text-[9px] bg-black/25 px-1 py-0.2 rounded-full font-mono font-normal">
                {remainingEdits}
              </span>
            </>
          ) : (
            <span className="text-[9px] bg-black/30 px-1.5 py-0.5 rounded-full font-mono text-neutral-400">
              locked
            </span>
          )}
        </button>
      )}
    </div>

    {/* Top Center Connecting Helper Prompt */}
    {isConnectingMode && (
      <div className="absolute top-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 bg-blue-600 text-white text-xs font-semibold px-5 py-2 rounded-full shadow-2xl backdrop-blur-md border border-blue-400/50 animate-bounce">
        <ArrowRight size={15} />
        <span>
          {!connectSourceId
            ? 'Click any shape/image to START line'
            : 'Now click another item to CONNECT'}
        </span>
        <button
          onClick={() => {
            setIsConnectingMode(false);
            setConnectSourceId(null);
          }}
          className="ml-2 hover:bg-black/20 p-1 rounded-full"
          title="Cancel"
        >
          <X size={14} />
        </button>
      </div>
    )}

    {/* Top Right Controls */}
    <div
      onMouseEnter={hideMyCursor}
      onMouseMove={(e) => {
        e.stopPropagation();
        hideMyCursor();
      }}
      className={`absolute top-5 right-5 z-50 flex items-center gap-1.5 backdrop-blur-md px-2.5 py-1.5 rounded-xl border shadow-2xl transition-colors duration-200 ${isDarkMode
        ? 'bg-neutral-900/90 border-neutral-800 text-neutral-300'
        : 'bg-white/95 border-slate-200 text-slate-700 shadow-slate-200/50'
        }`}
    >
      <button
        onClick={handleExportPNG}
        disabled={isExporting || elements.length === 0}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${isDarkMode
          ? 'hover:bg-neutral-800 text-emerald-400 hover:text-emerald-300 disabled:opacity-40'
          : 'hover:bg-slate-100 text-emerald-600 hover:text-emerald-800 disabled:opacity-40'
          }`}
        title="Export Canvas to PNG"
      >
        <Download size={14} className={isExporting ? 'animate-bounce' : ''} />
        <span className="hidden sm:inline">{isExporting ? 'Exporting...' : 'Export'}</span>
      </button>

      <div
        className={`h-3.5 w-px mx-0.5 ${isDarkMode ? 'bg-neutral-800' : 'bg-slate-300'
          }`}
      />

      <button
        onClick={toggleTheme}
        className={`p-1.5 rounded-lg transition-all ${isDarkMode
          ? 'hover:bg-neutral-800 text-amber-400 hover:text-amber-300'
          : 'hover:bg-slate-100 text-indigo-600 hover:text-indigo-800'
          }`}
        title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      >
        {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
      </button>

      <div
        className={`h-3.5 w-px mx-1 ${isDarkMode ? 'bg-neutral-800' : 'bg-slate-300'
          }`}
      />

      <button
        onClick={() => setZoom((z) => Math.max(z / 1.15, 0.4))}
        className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-neutral-800' : 'hover:bg-slate-100'
          }`}
        title="Zoom Out"
      >
        <ZoomOut size={15} />
      </button>
      <span className="text-xs font-mono px-1 w-12 text-center font-medium">
        {Math.round(zoom * 100)}%
      </span>
      <button
        onClick={() => setZoom((z) => Math.min(z * 1.15, 2.5))}
        className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-neutral-800' : 'hover:bg-slate-100'
          }`}
        title="Zoom In"
      >
        <ZoomIn size={15} />
      </button>
      <div
        className={`h-3.5 w-px mx-1 ${isDarkMode ? 'bg-neutral-800' : 'bg-slate-300'
          }`}
      />
      <button
        onClick={resetView}
        className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-neutral-800' : 'hover:bg-slate-100'
          }`}
        title="Reset View"
      >
        <RotateCcw size={14} />
      </button>
    </div>

    {/* Floating Canvas Creation Toolbar */}
    <div
      onMouseEnter={hideMyCursor}
      onMouseMove={(e) => {
        e.stopPropagation();
        hideMyCursor();
      }}
      className={`absolute bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 backdrop-blur-md p-1.5 rounded-2xl border shadow-2xl transition-colors duration-200 ${isDarkMode
        ? 'bg-neutral-900/95 border-neutral-800'
        : 'bg-white/95 border-slate-200 shadow-slate-300/60'
        }`}
    >
      <button
        onClick={() => addElement('note')}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 ${isDarkMode
          ? 'bg-neutral-800/80 hover:bg-neutral-700 text-white'
          : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
          }`}
        title="Add Sticky Note"
      >
        <StickyNote size={15} className="text-amber-400" />
        <span>Sticky</span>
      </button>

      <button
        onClick={() => addElement('rect')}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 ${isDarkMode
          ? 'bg-neutral-800/80 hover:bg-neutral-700 text-white'
          : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
          }`}
        title="Add Rectangle"
      >
        <Square size={15} className="text-blue-500" />
        <span>Rectangle</span>
      </button>

      <button
        onClick={() => addElement('circle')}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 ${isDarkMode
          ? 'bg-neutral-800/80 hover:bg-neutral-700 text-white'
          : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
          }`}
        title="Add Circle"
      >
        <CircleIcon size={15} className="text-emerald-500" />
        <span>Circle</span>
      </button>

      <button
        onClick={() => fileInputRef.current?.click()}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 ${isDarkMode
          ? 'bg-neutral-800/80 hover:bg-neutral-700 text-white'
          : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
          }`}
        title="Upload or Drag & Drop Image"
      >
        <ImageIcon size={15} className="text-purple-400" />
        <span>Image</span>
      </button>

      <button
        onClick={() => {
          setIsConnectingMode((prev) => {
            if (prev) setConnectSourceId(null);
            return !prev;
          });
        }}
        className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 ${isConnectingMode
          ? 'bg-blue-600 text-white shadow-lg ring-2 ring-blue-400/80 scale-105'
          : isDarkMode
            ? 'bg-neutral-800/80 hover:bg-neutral-700 text-white'
            : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
          }`}
        title="Connect Shapes (C)"
      >
        <ArrowRight
          size={15}
          className={
            isConnectingMode
              ? 'text-white'
              : isDarkMode
                ? 'text-cyan-400'
                : 'text-blue-600'
          }
        />
        <span>Connect</span>
      </button>

      <div
        className={`h-4 w-px mx-1 ${isDarkMode ? 'bg-neutral-800' : 'bg-slate-300'
          }`}
      />

      <div className="relative">
        <button
          onClick={() => setShowEmojiPicker((prev) => !prev)}
          className={`flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 ${isDarkMode
            ? 'bg-neutral-800/80 hover:bg-neutral-700 text-white'
            : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
            }`}
          title="Press 'E' for reactions"
        >
          <Smile size={15} className="text-yellow-400" />
          <span>React</span>
        </button>

        {showEmojiPicker && (
          <div
            onMouseEnter={hideMyCursor}
            onMouseMove={(e) => {
              e.stopPropagation();
              hideMyCursor();
            }}
            className={`absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2 backdrop-blur-lg px-3 py-2 rounded-2xl border shadow-2xl ${isDarkMode
              ? 'bg-neutral-800/95 border-neutral-700'
              : 'bg-white/95 border-slate-200 shadow-slate-300/60'
              }`}
          >
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => triggerReaction(emoji)}
                className={`text-2xl p-1.5 hover:scale-140 active:scale-95 transition-all duration-150 rounded-lg ${isDarkMode ? 'hover:bg-neutral-700/60' : 'hover:bg-slate-100'
                  }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>

    {/* Canvas Viewport */}
    <div
      ref={canvasViewportRef}
      id="board-canvas-viewport"
      className="absolute inset-0 origin-top-left pointer-events-none"
      style={{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
      }}
    >
      {/* SVG Connectors, Arrows, and Smart Alignment Guides Layer */}
      <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa" />
          </marker>
        </defs>

        {activeGuides.map((guide, idx) => {
          if (guide.orientation === 'vertical') {
            return (
              <line
                key={`guide-v-${idx}`}
                x1={guide.pos}
                y1={-50000}
                x2={guide.pos}
                y2={50000}
                stroke="#f43f5e"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                className="animate-pulse"
              />
            );
          }
          return (
            <line
              key={`guide-h-${idx}`}
              x1={-50000}
              y1={guide.pos}
              x2={50000}
              y2={guide.pos}
              stroke="#f43f5e"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              className="animate-pulse"
            />
          );
        })}

        {connectors.map((conn) => {
          const fromEl = elements.find((el) => el.id === conn.fromId);
          const toEl = elements.find((el) => el.id === conn.toId);
          if (!fromEl || !toEl) return null;

          const fromCenter = getElementCenter(fromEl);
          const toCenter = getElementCenter(toEl);

          const midX = (fromCenter.x + toCenter.x) / 2;
          const midY = (fromCenter.y + toCenter.y) / 2;

          return (
            <g
              key={conn.id}
              className="group pointer-events-auto cursor-pointer"
              onClick={(e) => deleteConnector(conn.id, e)}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <line
                x1={fromCenter.x}
                y1={fromCenter.y}
                x2={toCenter.x}
                y2={toCenter.y}
                stroke="transparent"
                strokeWidth="32"
                strokeLinecap="round"
              />

              <line
                x1={fromCenter.x}
                y1={fromCenter.y}
                x2={toCenter.x}
                y2={toCenter.y}
                stroke={conn.color || '#60a5fa'}
                strokeWidth="3"
                markerEnd="url(#arrowhead)"
                className="transition-colors group-hover:stroke-red-500"
              />

              <g className="opacity-0 group-hover:opacity-100 transition-opacity">
                <circle
                  cx={midX}
                  cy={midY}
                  r="11"
                  className="fill-red-600 stroke-neutral-900 stroke-2 drop-shadow-md"
                />
                <text
                  x={midX}
                  y={midY + 3.5}
                  textAnchor="middle"
                  className="fill-white font-bold text-[12px] select-none pointer-events-none"
                >
                  ×
                </text>
              </g>
            </g>
          );
        })}

        {isConnectingMode && sourceCenter && (
          <line
            x1={sourceCenter.x}
            y1={sourceCenter.y}
            x2={mouseWorldPos.x}
            y2={mouseWorldPos.y}
            stroke="#60a5fa"
            strokeWidth="2"
            strokeDasharray="6 6"
          />
        )}
      </svg>

      {/* Elements Rendering with 8 Handles (Corners + Sides) */}
      {elements.map((el) => {
        const isSelected = selectedElementId === el.id;
        const isConnectSource = connectSourceId === el.id;

        const baseHighlightClass = isConnectSource
          ? 'ring-4 ring-blue-500 scale-[1.04] shadow-blue-500/40'
          : isSelected
            ? 'ring-2 ring-blue-500 shadow-2xl'
            : isConnectingMode
              ? 'hover:ring-4 hover:ring-cyan-400 cursor-pointer animate-pulse'
              : 'cursor-grab hover:shadow-xl';

        if (el.type === 'image') {
          return (
            <div
              key={el.id}
              ref={(node) => {
                if (node) elementDomRefs.current.set(el.id, node);
                else elementDomRefs.current.delete(el.id);
              }}
              onClick={(e) => handleElementClick(e, el)}
              onMouseDown={(e) => handleMouseDownOnElement(e, el)}
              style={{
                transform: `translate3d(${el.x}px, ${el.y}px, 0)`,
                width: `${el.width || 260}px`,
                height: `${el.height || 200}px`,
                touchAction: 'none',
                willChange: 'transform',
                backfaceVisibility: 'hidden',
              }}
              className={`group pointer-events-auto absolute top-0 left-0 rounded-2xl shadow-2xl border p-1 transition-shadow ${isDarkMode
                ? 'bg-neutral-900/90 border-neutral-700/80'
                : 'bg-white border-slate-200 shadow-slate-200'
                } ${baseHighlightClass}`}
            >
              {renderResizeHandles(el)}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteElement(el.id);
                }}
                className="opacity-0 group-hover:opacity-100 absolute top-2 right-2 p-1.5 bg-neutral-950/80 hover:bg-red-500 text-white rounded-full shadow-lg transition-all z-20"
                title="Delete Image"
              >
                <Trash2 size={13} />
              </button>

              <StaticImageContent src={el.content} />
            </div>
          );
        }

        if (el.type === 'circle') {
          return (
            <div
              key={el.id}
              ref={(node) => {
                if (node) elementDomRefs.current.set(el.id, node);
                else elementDomRefs.current.delete(el.id);
              }}
              onClick={(e) => handleElementClick(e, el)}
              onMouseDown={(e) => handleMouseDownOnElement(e, el)}
              style={{
                transform: `translate3d(${el.x}px, ${el.y}px, 0)`,
                width: `${el.width || 140}px`,
                height: `${el.height || 140}px`,
                backgroundColor: el.color,
                willChange: 'transform',
                backfaceVisibility: 'hidden',
              }}
              className={`group pointer-events-auto absolute top-0 left-0 rounded-full shadow-2xl border border-black/10 flex flex-col items-center justify-center p-3 text-center transition-shadow ${baseHighlightClass}`}
            >
              {renderResizeHandles(el)}

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteElement(el.id);
                }}
                className="opacity-0 group-hover:opacity-100 absolute -top-1 -right-1 p-1 bg-white/80 hover:bg-red-500 hover:text-white rounded-full shadow transition-all text-neutral-700"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>

              <div className="w-full h-full overflow-hidden flex items-center justify-center px-2 py-4">
                <textarea
                  value={el.content}
                  onChange={(e) => updateElementContent(el.id, e.target.value)}
                  className="w-full h-full bg-transparent resize-none outline-none font-semibold text-neutral-800 text-xs text-center flex items-center justify-center break-words whitespace-pre-wrap overflow-y-auto leading-relaxed focus:cursor-text"
                  style={{ scrollbarWidth: 'none' }}
                />
              </div>

              <div className="opacity-0 group-hover:opacity-100 absolute -bottom-6 flex items-center gap-1 bg-neutral-900/80 px-1.5 py-0.5 rounded-full border border-neutral-700 transition-opacity">
                {PALETTE.map((c) => (
                  <button
                    key={c.bg}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateElementColor(el.id, c.bg);
                    }}
                    style={{ backgroundColor: c.bg }}
                    className="w-2.5 h-2.5 rounded-full border border-black/20"
                  />
                ))}
              </div>
            </div>
          );
        }

        if (el.type === 'rect') {
          return (
            <div
              key={el.id}
              ref={(node) => {
                if (node) elementDomRefs.current.set(el.id, node);
                else elementDomRefs.current.delete(el.id);
              }}
              onClick={(e) => handleElementClick(e, el)}
              onMouseDown={(e) => handleMouseDownOnElement(e, el)}
              style={{
                transform: `translate3d(${el.x}px, ${el.y}px, 0)`,
                width: `${el.width || 180}px`,
                height: `${el.height || 110}px`,
                backgroundColor: el.color,
                willChange: 'transform',
                backfaceVisibility: 'hidden',
              }}
              className={`group pointer-events-auto absolute top-0 left-0 rounded-xl shadow-2xl border border-black/10 flex flex-col justify-between p-3 transition-shadow ${baseHighlightClass}`}
            >
              {renderResizeHandles(el)}

              <div className="flex items-center justify-between pb-1 border-b border-black/10">
                <span className="text-[10px] font-mono text-neutral-600">block</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteElement(el.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-600 transition-opacity"
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="w-full flex-1 overflow-hidden py-1">
                <textarea
                  value={el.content}
                  onChange={(e) => updateElementContent(el.id, e.target.value)}
                  className="w-full h-full bg-transparent resize-none outline-none font-medium text-neutral-800 text-xs break-words whitespace-pre-wrap overflow-y-auto leading-relaxed focus:cursor-text"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1">
                  {PALETTE.map((c) => (
                    <button
                      key={c.bg}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateElementColor(el.id, c.bg);
                      }}
                      style={{ backgroundColor: c.bg }}
                      className="w-3 h-3 rounded-full border border-black/20 hover:scale-125 transition-transform"
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        }

        // Sticky Note
        return (
          <div
            key={el.id}
            ref={(node) => {
              if (node) elementDomRefs.current.set(el.id, node);
              else elementDomRefs.current.delete(el.id);
            }}
            onClick={(e) => handleElementClick(e, el)}
            onMouseDown={(e) => handleMouseDownOnElement(e, el)}
            style={{
              transform: `translate3d(${el.x}px, ${el.y}px, 0)`,
              width: `${el.width || 220}px`,
              height: `${el.height || 200}px`,
              backgroundColor: el.color,
              willChange: 'transform',
              backfaceVisibility: 'hidden',
            }}
            className={`group pointer-events-auto absolute top-0 left-0 rounded-xl shadow-2xl border border-black/10 flex flex-col justify-between p-3.5 transition-shadow ${baseHighlightClass}`}
          >
            {renderResizeHandles(el)}

            <div className="flex items-center justify-between pb-1 border-b border-black/10">
              <div className="flex items-center gap-1.5 opacity-60">
                <Sparkles size={13} className="text-neutral-700" />
                <span className="text-[10px] font-mono text-neutral-700">drag</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteElement(el.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/10 rounded-md transition-all text-neutral-700 hover:text-red-600"
                title="Delete Note"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="w-full flex-1 overflow-hidden py-1.5">
              <textarea
                value={el.content}
                onChange={(e) => updateElementContent(el.id, e.target.value)}
                className="w-full h-full bg-transparent resize-none outline-none font-medium text-neutral-800 text-sm break-words whitespace-pre-wrap overflow-y-auto leading-relaxed focus:cursor-text"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1.5">
                {PALETTE.map((c) => (
                  <button
                    key={c.bg}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateElementColor(el.id, c.bg);
                    }}
                    style={{ backgroundColor: c.bg }}
                    className={`w-3.5 h-3.5 rounded-full border border-black/20 transition-transform hover:scale-125 ${el.color === c.bg ? 'ring-1 ring-black/40 scale-110' : ''
                      }`}
                    title={c.name}
                  />
                ))}
              </div>
              <span className="text-[10px] text-neutral-600 font-mono">syncflow</span>
            </div>
          </div>
        );
      })}

      {/* Floating Emojis */}
      {reactions.map((r) => (
        <div
          key={r.id}
          className="emoji-burst absolute pointer-events-none z-50 flex flex-col items-center animate-emoji-burst select-none"
          style={{
            left: `${r.x}px`,
            top: `${r.y}px`,
          }}
        >
          <span className="text-6xl filter drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)]">
            {r.emoji}
          </span>
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full mt-1.5 border shadow-lg backdrop-blur-md whitespace-nowrap ${isDarkMode
              ? 'bg-neutral-900/90 text-white border-neutral-700/60'
              : 'bg-white/95 text-slate-800 border-slate-200'
              }`}
          >
            {r.userName}
          </span>
        </div>
      ))}

      {/* Remote Cursors */}
      {Object.values(remoteCursors).map((cursor) => (
        <div
          key={cursor.userId}
          className="remote-cursor pointer-events-none absolute transition-all duration-75 ease-out z-40"
          style={{
            left: `${cursor.x}px`,
            top: `${cursor.y}px`,
          }}
        >
          <MousePointer2
            size={20}
            style={{
              color: cursor.color,
              fill: cursor.color,
            }}
            className="-rotate-45 drop-shadow-md"
          />
          <span
            className="absolute left-4 top-2 text-[11px] font-semibold px-2 py-0.5 rounded-md text-white shadow-lg whitespace-nowrap"
            style={{ backgroundColor: cursor.color }}
          >
            {cursor.userName}
          </span>
        </div>
      ))}
    </div>
  </div>
);
}