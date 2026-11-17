
import type { ViewBuilderPlugin } from '@/sky-view-builder/core/plugin';

export const AutoTestPlugin: ViewBuilderPlugin<{ label: string }> = {
  id: "auto-test-plugin",
  pluginType: "basic",
  status: 'coming-soon',
  toolbar: {
    name: "Auto loded",
    // We can use a simple function returning JSX for the toolbar element
    element: () => (
      <div className="flex items-center justify-center w-full h-full font-black text-[10px] text-primary tracking-widest">
        AUTO
      </div>
    ),
    toolTip: "A simple plugin to test auto-loading feature"
  },
  canvas: {
    element: ({ configs }) => (
      <div className="flex flex-col items-center justify-center p-8 border-2 border-primary border-dashed rounded-2xl bg-primary/5 transition-all hover:bg-primary/10">
        <h2 className="text-2xl font-black text-primary uppercase tracking-wider">
          {configs.label || "Auto Loaded!"}
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          This local component was automatically discovered from the local-plugins directory!
        </p>
      </div>
    )
  },
  settings: [
    {
      field_id: "label",
      label: "Display Text",
      type: "text",
      defaultValue: "Auto Loaded!"
    }
  ],
  componentDataSchema: {}
};
