import { RecentCandidates } from "@/components/ui/recent-candidates"
import type { ViewBuilderPlugin } from "@/sky-view-builder/core/plugin"

import { Users } from "lucide-react"

type RecentCandidatesConfigs = {
  title?: string;
  subtitle?: string;
  maxItems?: number;
  showAvatar?: boolean;
  showStatus?: boolean;
  showScore?: boolean;
  showViewAll?: boolean;
};

export const RecentCandidatesPlugin: ViewBuilderPlugin<RecentCandidatesConfigs> = {
  id: "recent-candidates-plugin",
  pluginType: "basic",
  status: 'coming-soon',
  toolbar: {
    name: "Candidates",
    element: () => (
      <div className="flex h-full w-full items-center justify-center text-primary">
        <Users className="h-5 w-5" />
      </div>
    ),
    toolTip: "Recent Candidates List",
  },
  canvas: {
    element: ({ configs }) => <RecentCandidates configs={configs} />,
  },
  settings: [
    { field_id: 'title', label: 'Title', type: 'text', defaultValue: 'Recent Candidates' },
    { field_id: 'subtitle', label: 'Subtitle', type: 'text', defaultValue: 'Latest AI-screened applicants' },
    { field_id: 'maxItems', label: 'Max Items', type: 'number', defaultValue: 5 },
    { field_id: 'showAvatar', label: 'Show Avatar', type: 'checkbox', defaultValue: true },
    { field_id: 'showStatus', label: 'Show Status', type: 'checkbox', defaultValue: true },
    { field_id: 'showScore', label: 'Show Score', type: 'checkbox', defaultValue: true },
    { field_id: 'showViewAll', label: 'Show View All Button', type: 'checkbox', defaultValue: true },
  ],
  componentDataSchema: {},
}
