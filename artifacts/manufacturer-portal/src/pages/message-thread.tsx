import { useState, useRef, useEffect } from "react";
import { useGetThreadMessages, useListManufacturerThreads, useSendThreadMessage, useUploadManufacturerThreadAttachment, getGetThreadMessagesQueryKey, getListManufacturerThreadsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Send, Package, MessageSquare, Paperclip, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Message } from "@workspace/api-client-react";
import { EmptyState, QueryError } from "@/components/query-state";
import { ThreadCall } from "@/components/thread-call";

export default function MessageThread({ threadId }: { threadId: string }) {
  const messagesQuery = useGetThreadMessages(threadId, { query: { enabled: !!threadId, queryKey: getGetThreadMessagesQueryKey(threadId), refetchInterval: 10_000 } });
  const threadsQuery = useListManufacturerThreads({ query: { queryKey: getListManufacturerThreadsQueryKey(), refetchInterval: 10_000 } });
  const { data: messages, isLoading: messagesLoading } = messagesQuery;
  const { data: threads } = threadsQuery;
  const sendMutation = useSendThreadMessage();
  const uploadMutation = useUploadManufacturerThreadAttachment();
  const queryClient = useQueryClient();
  
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef<string | null>(null);

  const thread = threads?.find(t => t.id === threadId);

  useEffect(() => {
    // Scroll to bottom when messages load
    if (messages) {
      endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSend = async () => {
    const clientRequestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = clientRequestId;
    if ((!draft.trim() && !attachment) || !threadId) return;
    let mediaUrls: string[] | undefined;
    const file = attachment;
    if (file) {
      try {
        // Pass the selected File itself so the generated client receives its
        // original bytes and exact MIME type (image/jpeg, image/png, or application/pdf).
        const uploaded = await uploadMutation.mutateAsync({ threadId, data: file });
        mediaUrls = [uploaded.objectPath];
      } catch {
        return;
      }
    }
    sendMutation.mutate(
      { threadId, data: { clientRequestId, content: draft.trim() || undefined, messageType: mediaUrls ? (file?.type.startsWith("image/") ? "image" : "text") : "text", mediaUrls } },
      {
        onSuccess: (newMessage) => {
          setDraft("");
          setAttachment(null);
          requestIdRef.current = null;
          // Optimistically update cache
          queryClient.setQueryData(getGetThreadMessagesQueryKey(threadId), (old: Message[] | undefined) => 
            old ? [...old, newMessage] : [newMessage]
          );
          void queryClient.invalidateQueries({ queryKey: getListManufacturerThreadsQueryKey() });
        },
        onError: () => {
          void queryClient.invalidateQueries({ queryKey: getGetThreadMessagesQueryKey(threadId) });
          void queryClient.invalidateQueries({ queryKey: getListManufacturerThreadsQueryKey() });
        },
      }
    );
  };

  if (messagesLoading || threadsQuery.isLoading) {
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

  if (messagesQuery.isError || threadsQuery.isError) {
    return (
      <QueryError
        title="Unable to load conversation"
        description="The latest messages could not be retrieved."
        onRetry={() => {
          void messagesQuery.refetch();
          void threadsQuery.refetch();
        }}
      />
    );
  }

  if (!thread) {
    return <EmptyState icon={MessageSquare} title="Conversation not found" description="It may have been removed or you may no longer have access." />;
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
        <ThreadCall threadId={threadId} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {messages?.length === 0 && (
          <div className="py-16 text-center text-sm text-muted-foreground" data-testid="status-empty-thread">
            No messages yet. Send the first reply below.
          </div>
        )}
        {messages?.map((msg, i) => {
          const isMe = msg.senderRole === "manufacturer";
          const richMessage = msg as typeof msg & { messageType?: string; mediaUrls?: string[]; cardData?: Record<string, unknown> | null };
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
                {richMessage.mediaUrls?.map((url) => url.match(/\.(pdf)(\?|$)/i) ? (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-2 underline"><FileText className="h-4 w-4" />Open PDF attachment</a>
                ) : <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Message attachment" className="mt-3 max-h-64 rounded object-cover" /></a>)}
                {(richMessage.messageType === "sample_card" || richMessage.messageType === "bulk_card") && richMessage.cardData && typeof richMessage.cardData.orderId === "string" && (
                  <Link href={`/orders/${richMessage.cardData.orderId}`} className="mt-3 block rounded border border-current/30 p-3 font-medium underline" data-testid={`link-message-order-${msg.id}`}>
                    Open {richMessage.messageType === "bulk_card" ? "bulk" : "sample"} order tracker
                  </Link>
                )}
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
            data-testid="input-message-draft"
          />
          <label className="flex cursor-pointer items-center justify-center rounded border border-border px-3 hover:bg-secondary" data-testid="button-attach-message">
            <Paperclip className="h-4 w-4" />
            <input type="file" accept="image/*,.pdf,application/pdf" className="sr-only" onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} />
          </label>
          <Button 
            onClick={handleSend}
            disabled={(!draft.trim() && !attachment) || sendMutation.isPending || uploadMutation.isPending}
            className="h-auto px-6"
            data-testid="button-send-message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        {attachment && <p className="mt-2 text-xs text-muted-foreground" data-testid="text-attachment-name">Attached: {attachment.name}</p>}
        {uploadMutation.isError && <p className="mt-2 text-sm text-destructive" role="alert">Attachment upload failed. Please try again.</p>}
        {sendMutation.isError && (
          <p className="mt-2 text-sm text-destructive" role="alert" data-testid="status-send-error">
            Message not sent. Check your connection and try again.
          </p>
        )}
      </div>
    </div>
  );
}
