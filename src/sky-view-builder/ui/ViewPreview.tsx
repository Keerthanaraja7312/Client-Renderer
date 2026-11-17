import React from 'react';
import { Canvas } from './Canvas';
import { type ComponentInstance } from '../index';

interface ViewPreviewProps {
    /** The list of component instances to render */
    instances: ComponentInstance[];
    /** Layout data for the grid */
    layouts: any;
    /** Optional: className for the container */
    className?: string;
}

/**
 * A standalone component to render the view in preview mode.
 * It doesn't include any editing tools, toolbars, or settings panels.
 */
export const ViewPreview: React.FC<ViewPreviewProps> = ({
    instances,
    layouts,
    className = ""
}) => {
    return (
        <div className={`w-full h-full bg-background overflow-auto ${className}`}>
            <Canvas
                instances={instances}
                layouts={layouts}
                isPreview={true}
                onSelect={() => { }}
                onDelete={() => { }}
                onLayoutChange={() => { }}
                selectedId={null}
            />
        </div>
    );
};
