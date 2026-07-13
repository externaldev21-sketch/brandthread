import { useListManufacturerThreads } from "@workspace/api-client-react";
import { Link } from "wouter";
import { MessageSquare, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";

export default function Messages() {
  const { data: threads, isLoading } = useListManufacturerThreads();
  const [searchTerm, setSearchTerm] = useState("");

  const filteredThreads = threads?.filter(t => 
    t.buyerName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    t.subject.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500 h-full flex flex-col">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Messages</h1>
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
        />
      </div>

      <div className="flex-1 overflow-hidden flex flex-col bg-card border border-border rounded-lg">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-secondary/50 rounded animate-pulse"></div>
            ))}
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
            <MessageSquare className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
            <h3 className="font-semibold text-lg mb-2">No messages found</h3>
            <p className="text-muted-foreground">Your inbox is empty.</p>
          </div>
        ) : (
          <div className="divide-y divide-border overflow-y-auto">
            {filteredThreads.map((thread) => (
              <Link 
                key={thread.id} 
                href={`/messages/${thread.id}`}
                className="block hover:bg-secondary/40 transition-colors p-4 md:p-6"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-full bg-secondary border border-border flex items-center justify-center font-bold shrink-0 text-muted-foreground">
                    {thread.buyerAvatar ? (
                      <img src={thread.buyerAvatar} alt={thread.buyerName} className="w-full h-full rounded-full object-cover" />
                    ) : (
                      thread.buyerName.substring(0, 2).toUpperCase()
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className={`font-semibold truncate pr-4 ${thread.unreadCount > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                        {thread.buyerName}
                      </h3>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(thread.lastMessageAt), { addSuffix: true })}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-medium truncate">{thread.subject}</span>
                      {thread.orderStatus && (
                        <span className="px-2 py-0.5 bg-secondary text-[10px] uppercase tracking-wider rounded font-mono border border-border text-muted-foreground">
                          {thread.orderStatus.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    
                    <p className="text-sm text-muted-foreground line-clamp-1">
                      {thread.lastMessage}
                    </p>
                  </div>
                  
                  {thread.unreadCount > 0 && (
                    <div className="w-5 h-5 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center font-bold shrink-0 mt-1">
                      {thread.unreadCount}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
