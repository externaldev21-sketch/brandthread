import { useState, useRef, useEffect } from "react";
import { useGetThreadMessages, useListManufacturerThreads, useSendThreadMessage, getGetThreadMessagesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Send, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Message } from "@workspace/api-client-react";

export default function MessageThread({ threadId }: { threadId: string }) {
  const { data: messages, isLoading: messagesLoading } = useGetThreadMessages(threadId, { query: { enabled: !!threadId, queryKey: getGetThreadMessagesQueryKey(threadId) } });
  const { data: threads } = useListManufacturerThreads();
  const sendMutation = useSendThreadMessage();
  const queryClient = useQueryClient();
  
  const [draft, setDraft] = useState("");
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  const thread = threads?.find(t => t.id === threadId);

  useEffect(() => {
    // Scroll to bottom when messages load
    if (messages) {
      endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSend = () => {
    if (!draft.trim() || !threadId) return;

    sendMutation.mutate(
      { threadId, data: { content: draft } },
      {
        onSuccess: (newMessage) => {
          setDraft("");
          // Optimistically update cache
          queryClient.setQueryData(getGetThreadMessagesQueryKey(threadId), (old: Message[] | undefined) => 
            old ? [...old, newMessage] : [newMessage]
          );
        }
      }
    );
  };

  if (messagesLoading || !thread) {
    return (
      <div className="h-full flex flex-col border border-border bg-card rounded-lg animate-pulse">
        <div className="h-16 border-b border-border bg-secondary/20"></div>
        <div className="flex-1 p-6 space-y-6">
          <div className="h-16 w-2/3 bg-secondary/50 rounded-lg"></div>
          <div className="h-16 w-2/3 bg-secondary/50 rounded-lg ml-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col border border-border bg-card rounded-lg overflow-hidden animate-in fade-in duration-300 relative">
      {/* Header */}
      <div className="h-16 border-b border-border bg-card/80 backdrop-blur-sm flex items-center px-4 md:px-6 shrink-0 z-10 sticky top-0">
        <Link href="/messages" className="mr-4 text-muted-foreground hover:text-foreground transition-colors p-2 -ml-2 rounded-full hover:bg-secondary">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-secondary border border-border flex items-center justify-center font-bold text-muted-foreground shrink-0">
            {thread.buyerAvatar ? (
              <img src={thread.buyerAvatar} alt={thread.buyerName} className="w-full h-full rounded-full object-cover" />
            ) : (
              thread.buyerName.substring(0, 2).toUpperCase()
            )}
          </div>
          <div className="truncate">
            <h2 className="font-semibold text-sm md:text-base truncate">{thread.buyerName}</h2>
            <p className="text-xs text-muted-foreground truncate">{thread.subject}</p>
          </div>
        </div>
        
        {thread.orderStatus && (
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-secondary/50 border border-border rounded text-xs font-mono uppercase tracking-wider text-muted-foreground">
            <Package className="w-3 h-3" />
            {thread.orderStatus.replace('_', ' ')}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {messages?.map((msg, i) => {
          const isMe = msg.senderRole === "manufacturer";
          const showTime = i === 0 || new Date(msg.sentAt).getTime() - new Date(messages[i-1].sentAt).getTime() > 1000 * 60 * 30; // 30 mins
          
          return (
            <div key={msg.id} className="flex flex-col">
              {showTime && (
                <div className="text-center text-xs text-muted-foreground font-mono mb-4 mt-2">
                  {new Date(msg.sentAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
              <div className={cn(
                "max-w-[85%] md:max-w-[70%] rounded-lg px-4 py-3 text-sm",
                isMe 
                  ? "bg-primary text-primary-foreground self-end" 
                  : "bg-secondary border border-border text-foreground self-start"
              )}>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
              <span className={cn(
                "text-[10px] text-muted-foreground mt-1 px-1",
                isMe ? "self-end" : "self-start"
              )}>
                {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          );
        })}
        <div ref={endOfMessagesRef} className="h-1" />
      </div>

      {/* Input */}
      <div className="p-4 bg-card border-t border-border shrink-0">
        <div className="flex gap-3">
          <Textarea 
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type your reply... (Press Enter to send)" 
            className="min-h-[60px] max-h-[150px] bg-secondary/30 resize-none border-border"
          />
          <Button 
            onClick={handleSend}
            disabled={!draft.trim() || sendMutation.isPending}
            className="h-auto px-6"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
