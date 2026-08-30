import { useListManufacturerThreads } from "@workspace/api-client-react";
import { MessageSquare, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { ThreadCard } from "@/components/thread-card";
import { EmptyState, QueryError } from "@/components/query-state";

export default function Messages() {
  const { data: threads, isLoading, isError, refetch } = useListManufacturerThreads();
  const [searchTerm, setSearchTerm] = useState("");

  const filteredThreads = threads?.filter(t => 
    t.buyerName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.subject.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500 h-full flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inbox</h1>
          <p className="text-muted-foreground mt-1">Communicate directly with brands and buyers.</p>
        </div>
      </div>

      <div className="relative max-w-md shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input 
          placeholder="Search by buyer or subject..." 
          className="pl-9 h-11 bg-card border-border"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          data-testid="input-search-inbox"
        />
      </div>

      <div className="flex-1 overflow-hidden flex flex-col bg-card border border-border rounded-lg">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-secondary/50 rounded animate-pulse"></div>
            ))}
          </div>
        ) : isError ? (
          <div className="p-6">
            <QueryError title="Unable to load inbox" description="Your conversations could not be retrieved." onRetry={() => void refetch()} />
          </div>
        ) : filteredThreads.length === 0 ? (
          <EmptyState icon={MessageSquare} title={searchTerm ? "No matching conversations" : "Your inbox is clear"} description={searchTerm ? "Try a different seller or subject." : "New seller conversations will appear here."} />
        ) : (
          <div className="divide-y divide-border overflow-y-auto">
            {filteredThreads.map((thread) => <ThreadCard key={thread.id} thread={thread} />)}
          </div>
        )}
      </div>
    </div>
  );
}
