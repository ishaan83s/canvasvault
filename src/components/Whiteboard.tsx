import React from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

interface WhiteboardProps {
  onApiReady?: (api: ExcalidrawImperativeAPI) => void;
  onChange?: (elements: readonly any[], appState: any, files: any) => void;
}

export const Whiteboard: React.FC<WhiteboardProps> = ({ onApiReady, onChange }) => {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Excalidraw
        excalidrawAPI={onApiReady}
        onChange={onChange}
      />
    </div>
  );
};

export default Whiteboard;
