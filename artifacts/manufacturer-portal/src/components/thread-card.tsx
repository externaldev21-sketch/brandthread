import type { MessageThread } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { orderStatusLabel } from "@workspace/manufacturer-flow";

export function ThreadCard({ thread }: { thread: MessageThread }) {
  return (
    <Link
      href={`/messages/${thread.id}`}
      className="block p-4 transition-colors hover:bg-secondary/40 md:p-6"
      data-testid={`link-thread-${thread.id}`}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-secondary font-bold text-muted-foreground">
          {thread.buyerAvatar ? (
            <img
              src={thread.buyerAvatar}
              alt=""
              className="h-full w-full object-cover"
              data-testid={`img-buyer-${thread.id}`}
            />
          ) : (
            thread.buyerName.substring(0, 2).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-start justify-between">
            <h3
              className={`truncate pr-4 font-semibold ${thread.unreadCount ? "text-foreground" : "text-muted-foreground"}`}
              data-testid={`text-buyer-${thread.id}`}
            >
              {thread.buyerName}
            </h3>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(thread.lastMessageAt), { addSuffix: true })}
            </span>
          </div>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="truncate text-sm font-medium">{thread.subject}</span>
            {thread.orderStatus && (
              <span className="rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {orderStatusLabel(thread.orderStatus)}
              </span>
            )}
          </div>
          <p className="line-clamp-1 text-sm text-muted-foreground">{thread.lastMessage}</p>
        </div>
        {thread.unreadCount > 0 && (
          <div
            className="mt-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground"
            data-testid={`status-unread-${thread.id}`}
          >
            {thread.unreadCount}
          </div>
        )}
      </div>
    </Link>
  );
}