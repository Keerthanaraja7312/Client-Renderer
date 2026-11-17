import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

// Mock data based on the screenshot
const candidates = [
  {
    id: 1,
    name: "Murugan Selvam",
    status: "Shortlisted",
    role: "Senior Electrician at Saudi Binladin Group",
    score: 94,
    avatar: "https://i.pravatar.cc/150?u=murugan",
  },
  {
    id: 2,
    name: "Rajesh Kumar",
    status: "Interview",
    role: "Master Plumber at Al Habtoor Construction",
    score: 89,
    avatar: "https://i.pravatar.cc/150?u=rajesh",
  },
  {
    id: 3,
    name: "Venkatesh Naidu",
    status: "Shortlisted",
    role: "Shuttering Carpenter at Arabtec Construction",
    score: 91,
    avatar: "https://i.pravatar.cc/150?u=venkatesh",
  },
  {
    id: 4,
    name: "Suresh Babu",
    status: "Screening",
    role: "Helper - Electrical at Local Contractor",
    score: 65,
    avatar: "https://i.pravatar.cc/150?u=suresh",
  },
  {
    id: 5,
    name: "Arjun Reddy",
    status: "New",
    role: "HVAC Technician at Voltas Limited",
    score: 80,
    avatar: "https://i.pravatar.cc/150?u=arjun",
  },
]

const getStatusColor = (status: string) => {
  switch (status) {
    case "Shortlisted":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20"
    case "Interview":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 border-amber-500/20"
    case "Screening":
      return "bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 border-purple-500/20"
    case "New":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 border-blue-500/20"
    default:
      return "bg-secondary text-secondary-foreground hover:bg-secondary/80 border-border"
  }
}

const getScoreColor = (score: number) => {
  if (score >= 80)
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
  if (score >= 60)
    return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
  return "bg-destructive/10 text-destructive dark:text-destructive border-destructive/20"
}

type RecentCandidatesProps = {
  configs?: {
    title?: string;
    subtitle?: string;
    maxItems?: number;
    showAvatar?: boolean;
    showStatus?: boolean;
    showScore?: boolean;
    showViewAll?: boolean;
  };
};

export const RecentCandidates = ({ configs }: RecentCandidatesProps) => {
  const {
    title = 'Recent Candidates',
    subtitle = 'Latest AI-screened applicants',
    maxItems = 5,
    showAvatar = true,
    showStatus = true,
    showScore = true,
    showViewAll = true,
  } = configs || {};

  const visibleCandidates = candidates.slice(0, Math.max(1, maxItems));

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between p-6 pb-4">
        <div className="flex flex-col gap-1">
          <div className="font-semibold text-foreground">{title}</div>
          <div className="text-muted-foreground">{subtitle}</div>
        </div>
        {showViewAll && (
          <button className="group flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            View all
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <div className="flex flex-col">
          {visibleCandidates.map((candidate, index) => (
            <div
              key={candidate.id}
              className={cn(
                "flex items-center justify-between border-t border-border p-4 px-6 transition-colors hover:bg-muted/50",
                index === visibleCandidates.length - 1 ? 'border-b border-border' : ''
              )}
            >
              <div className="flex items-center gap-4">
                {showAvatar && (
                  <img
                    src={candidate.avatar}
                    alt={candidate.name}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                )}
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-3">
                    <div className="font-medium text-foreground">{candidate.name}</div>
                    {showStatus && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full border px-2 py-0 font-medium",
                          getStatusColor(candidate.status)
                        )}
                      >
                        {candidate.status}
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground">{candidate.role}</div>
                </div>
              </div>
              {showScore && (
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold",
                    getScoreColor(candidate.score)
                  )}
                >
                  {candidate.score}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
