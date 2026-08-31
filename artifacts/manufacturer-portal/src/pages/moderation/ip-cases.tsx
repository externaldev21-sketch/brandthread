import { useState } from 'react';
import { useIpCases, useIpCaseAudit, useUpdateIpCase } from '@/hooks/use-ip-cases';
import type { IpCase } from '@/hooks/use-ip-cases';
import { Shield, AlertTriangle, XCircle, Clock, Info, FileText, ImageIcon, User, LinkIcon, AlertOctagon, HistoryIcon } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'submitted': return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-800 text-slate-300 border border-slate-700" data-testid={`badge-status-${status}`}>Submitted</span>;
    case 'under_review': return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30" data-testid={`badge-status-${status}`}>Reviewing</span>;
    case 'information_requested': return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30" data-testid={`badge-status-${status}`}>Info Req</span>;
    case 'dismissed': return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-800/50 text-slate-500 border border-slate-800" data-testid={`badge-status-${status}`}>Dismissed</span>;
    case 'actioned': return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-red-500/20 text-red-400 border border-red-500/30" data-testid={`badge-status-${status}`}>Actioned</span>;
    default: return <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-800 text-slate-300" data-testid={`badge-status-${status}`}>{status}</span>;
  }
}

function CaseDetailView({ caseData }: { caseData: IpCase }) {
  const { toast } = useToast();
  const updateMutation = useUpdateIpCase();
  const { data: auditLog } = useIpCaseAudit(caseData.id);
  const [activeTab, setActiveTab] = useState<'details' | 'audit'>('details');

  const [actionModal, setActionModal] = useState<{
    isOpen: boolean;
    type: 'request_info' | 'dismiss' | 'hide' | 'remove' | null;
  }>({ isOpen: false, type: null });
  const [notes, setNotes] = useState('');

  const handleAction = async () => {
    if (!actionModal.type) return;
    
    try {
      const payload: {
        moderatorNotes: string;
        status?: IpCase['status'];
        action?: 'hide_listing' | 'remove_listing';
      } = { moderatorNotes: notes };
      
      switch (actionModal.type) {
        case 'request_info':
          payload.status = 'information_requested';
          break;
        case 'dismiss':
          payload.status = 'dismissed';
          break;
        case 'hide':
          payload.action = 'hide_listing';
          break;
        case 'remove':
          payload.action = 'remove_listing';
          break;
      }

      await updateMutation.mutateAsync({ id: caseData.id, data: payload });
      toast({ title: 'Case updated successfully' });
      setActionModal({ isOpen: false, type: null });
      setNotes('');
    } catch (err) {
      toast({ title: 'Failed to update case', variant: 'destructive' });
    }
  };

  const setUnderReview = () => {
    updateMutation.mutate({ id: caseData.id, data: { status: 'under_review' } }, {
      onSuccess: () => toast({ title: 'Status set to Under Review' })
    });
  };

  const isResolved = caseData.status === 'dismissed' || caseData.status === 'actioned';

  return (
    <div className="flex flex-col h-full overflow-hidden text-slate-200">
      <div className="p-6 border-b border-blue-900/30 bg-slate-900/30 flex items-start justify-between shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-xl font-semibold tracking-tight text-white" data-testid={`text-case-ref-${caseData.id}`}>
              Case {caseData.publicReference}
            </h2>
            <StatusBadge status={caseData.status} />
          </div>
          <p className="text-sm text-slate-400 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Submitted {format(new Date(caseData.createdAt), 'MMM d, yyyy HH:mm')}
          </p>
        </div>
        
        <div className="flex gap-2">
          {!isResolved && (caseData.status === 'submitted' || caseData.status === 'information_requested') && (
            <button 
              onClick={setUnderReview}
              disabled={updateMutation.isPending}
              data-testid="button-set-review"
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-blue-900/30 text-blue-400 hover:bg-blue-900/50 border border-blue-800/50 transition-colors"
            >
              Start Review
            </button>
          )}
          {!isResolved && (
            <>
              <button 
                onClick={() => setActionModal({ isOpen: true, type: 'request_info' })}
                data-testid="button-request-info"
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors border border-slate-700"
              >
                Request Info
              </button>
              <button 
                onClick={() => setActionModal({ isOpen: true, type: 'dismiss' })}
                data-testid="button-dismiss-case"
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors border border-slate-700"
              >
                Dismiss
              </button>
              <button 
                onClick={() => setActionModal({ isOpen: true, type: 'hide' })}
                disabled={!caseData.listingProductId}
                data-testid="button-hide-listing"
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-red-950/30 text-red-400 hover:bg-red-900/40 transition-colors border border-red-900/50 flex items-center gap-2"
              >
                <AlertTriangle className="w-4 h-4" />
                Hide Listing
              </button>
              <button 
                onClick={() => setActionModal({ isOpen: true, type: 'remove' })}
                disabled={!caseData.listingProductId}
                data-testid="button-remove-listing"
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-red-700 text-white hover:bg-red-600 transition-colors border border-red-600 flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AlertTriangle className="w-4 h-4" />
                Remove Listing
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex px-6 border-b border-blue-900/30 shrink-0 bg-slate-900/10">
        <button
          onClick={() => setActiveTab('details')}
          data-testid="tab-details"
          className={cn(
            "px-4 py-3 text-sm font-medium border-b-2 transition-colors",
            activeTab === 'details' ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-slate-300"
          )}
        >
          Claim Details
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          data-testid="tab-audit"
          className={cn(
            "px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2",
            activeTab === 'audit' ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-slate-300"
          )}
        >
          <HistoryIcon className="w-4 h-4" />
          Audit Log
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 bg-slate-950">
        {activeTab === 'details' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl">
            <div className="space-y-8">
              <section>
                <h3 className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
                  <User className="w-4 h-4" /> Claimant Information
                </h3>
                <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-4 space-y-3">
                  <div>
                    <div className="text-xs text-slate-500">Name / Organization</div>
                    <div className="font-medium" data-testid="text-claimant-name">{caseData.claimantName}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Email Address</div>
                    <div className="font-medium font-mono text-sm" data-testid="text-claimant-email">{caseData.claimantEmail}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Additional Contact</div>
                    <div className="text-sm" data-testid="text-claimant-contact">{caseData.claimantContact || 'None provided'}</div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Claim Details
                </h3>
                <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-4 space-y-4">
                  <div>
                    <div className="text-xs text-slate-500">Rights Type</div>
                    <div className="font-medium" data-testid="text-rights-type">{caseData.rightsType}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Description</div>
                    <div className="text-sm mt-1 text-slate-300 leading-relaxed whitespace-pre-wrap" data-testid="text-claim-description">
                      {caseData.description}
                    </div>
                  </div>
                  {caseData.evidenceReferences?.length > 0 && (
                    <div>
                      <div className="text-xs text-slate-500 mb-2">Evidence References</div>
                      <div className="space-y-1">
                        {caseData.evidenceReferences.map((ref, idx) => /^https?:\/\//i.test(ref) ? (
                          <a
                            key={idx}
                            href={ref}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 break-all text-sm text-blue-400 hover:underline"
                            data-testid={`link-evidence-${idx}`}
                          >
                            <LinkIcon className="w-3 h-3 shrink-0" />
                            {ref}
                          </a>
                        ) : (
                          <p key={idx} className="break-all text-sm text-slate-300" data-testid={`text-evidence-${idx}`}>
                            {ref}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="space-y-8">
              <section>
                <h3 className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
                  <AlertOctagon className="w-4 h-4" /> Reported Listing
                </h3>
                <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-4 space-y-4">
                    {caseData.listingUrl && <div>
                    <div className="text-xs text-slate-500">Listing URL</div>
                    <a href={caseData.listingUrl} target="_blank" rel="noreferrer" className="text-sm font-mono text-blue-400 hover:underline flex items-center gap-2 mt-1 break-all" data-testid="link-listing-url">
                      {caseData.listingUrl}
                    </a>
                    </div>}
                  
                  {caseData.listingContext ? (
                    <div className="pt-4 border-t border-slate-800">
                      <div className="text-xs text-slate-500 mb-3">Current listing context</div>
                      <div className="flex gap-4">
                        {caseData.listingContext.images?.[0] ? (
                          <img 
                            src={caseData.listingContext.images[0].startsWith('/objects/')
                              ? `/api/storage${caseData.listingContext.images[0]}`
                              : caseData.listingContext.images[0]} 
                            alt="Listing snapshot" 
                            className="w-20 h-20 object-cover rounded bg-slate-800 border border-slate-700"
                            data-testid="img-listing-snapshot"
                          />
                        ) : (
                          <div className="w-20 h-20 rounded bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-600">
                            <ImageIcon className="w-6 h-6" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate" data-testid="text-listing-name">{caseData.listingContext.name}</div>
                          <div className="text-xs text-slate-400 mt-1 line-clamp-3" data-testid="text-listing-description">{caseData.listingContext.description || 'No description'}</div>
                          <div className="text-xs text-slate-500 mt-2 font-mono">Owner ID: {caseData.listingContext.ownerId}</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-4 border-t border-slate-800 text-sm text-amber-500/80 flex items-center gap-2" data-testid="text-listing-missing">
                      <AlertTriangle className="w-4 h-4" />
                      Listing context unavailable or deleted
                    </div>
                  )}
                </div>
              </section>

              {caseData.moderatorNotes && (
                <section>
                  <h3 className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
                    <Info className="w-4 h-4" /> Current Moderator Notes
                  </h3>
                  <div className="bg-slate-800/30 rounded-lg border border-slate-700/50 p-4 text-sm text-slate-300 whitespace-pre-wrap" data-testid="text-moderator-notes">
                    {caseData.moderatorNotes}
                  </div>
                </section>
              )}
            </div>
          </div>
        ) : (
          <div className="max-w-4xl">
            {!auditLog ? (
              <div className="text-center text-slate-500 p-8">Loading audit log...</div>
            ) : auditLog.length === 0 ? (
              <div className="text-center text-slate-500 p-8">No audit history found.</div>
            ) : (
              <div className="space-y-4">
                {auditLog.map((log) => (
                  <div key={log.id} className="flex flex-col sm:flex-row sm:items-start gap-4 p-4 rounded-lg bg-slate-900/30 border border-slate-800" data-testid={`audit-row-${log.id}`}>
                    <div className="sm:w-36 shrink-0 text-xs text-slate-500 font-mono pt-0.5">
                      {format(new Date(log.createdAt), 'yyyy-MM-dd HH:mm')}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-300">
                        {log.action.replace(/_/g, ' ').toUpperCase()}
                        {log.previousStatus && log.nextStatus && (
                          <span className="text-slate-500 font-normal ml-2 text-xs uppercase tracking-wide">
                            ({log.previousStatus} &rarr; {log.nextStatus})
                          </span>
                        )}
                      </div>
                      {log.details && (
                        <div className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">
                          {JSON.stringify(log.details, null, 2)}
                        </div>
                      )}
                      <div className="text-[10px] text-slate-600 font-mono mt-2">
                        Actor: {log.actorId}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={actionModal.isOpen} onOpenChange={(open) => !open && setActionModal({ isOpen: false, type: null })}>
        <DialogContent className={cn(
          "bg-slate-950 border-slate-800 text-slate-200",
          (actionModal.type === 'remove' || actionModal.type === 'hide') && "border-red-900/50 bg-slate-950 shadow-[0_0_40px_-10px_rgba(220,38,38,0.2)]"
        )}>
          <DialogHeader>
            <DialogTitle className="text-slate-100 flex items-center gap-2">
              {actionModal.type === 'request_info' && <><Info className="w-5 h-5 text-blue-500" /> Request Information</>}
              {actionModal.type === 'dismiss' && <><XCircle className="w-5 h-5 text-slate-400" /> Dismiss Case</>}
              {(actionModal.type === 'hide' || actionModal.type === 'remove') && <><AlertTriangle className="w-5 h-5 text-red-500" /> Enforce Listing Action</>}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {actionModal.type === 'request_info' && "Mark this case as waiting for more claimant information. The case status will change to Information Requested."}
              {actionModal.type === 'dismiss' && "Close this case without taking action against the listing."}
              {actionModal.type === 'hide' && (
                <span className="text-red-400/80 font-medium">
                  Confirm that this listing should be archived and hidden from public view. The action is recorded in the immutable history.
                </span>
              )}
              {actionModal.type === 'remove' && (
                <span className="text-red-400/80 font-medium">
                  Warning: This permanently marks the listing as moderation-removed, archives it, and removes it from public view. The action is recorded in the immutable history.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Moderator Notes (Required)
            </label>
            <textarea
              className="w-full h-32 bg-slate-900 border border-slate-700 rounded-md p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500 resize-none"
              placeholder="Detail the reasoning for this action. These notes will be added to the audit log."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="textarea-moderator-notes"
            />
          </div>

          <DialogFooter>
            <button 
              onClick={() => setActionModal({ isOpen: false, type: null })}
              className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-300"
              data-testid="button-cancel-modal"
            >
              Cancel
            </button>
            <button 
              onClick={handleAction}
              disabled={!notes.trim() || updateMutation.isPending}
              data-testid="button-confirm-modal"
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-50",
                (actionModal.type === 'hide' || actionModal.type === 'remove')
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              )}
            >
              {updateMutation.isPending ? 'Confirming...' : 'Confirm Action'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function IpCases() {
  const [statusFilter, setStatusFilter] = useState<string>('submitted');
  const { data: cases, isLoading, error } = useIpCases(statusFilter);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const selectedCase = cases?.find(c => c.id === selectedCaseId) || null;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] space-y-4">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-blue-50 flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-500" />
            Safety Review Queue
          </h1>
          <p className="text-sm text-blue-200/60 mt-1">
            Review and adjudicate intellectual property and rights claims.
          </p>
        </div>
      </div>

      <div className="flex-1 flex border border-blue-900/30 rounded-xl overflow-hidden bg-card/50 shadow-sm ring-1 ring-white/5 min-h-0">
        <div className="w-80 lg:w-96 border-r border-blue-900/30 flex flex-col bg-slate-950/50">
          <div className="p-4 border-b border-blue-900/30 bg-slate-900/50 shrink-0">
            <div className="flex gap-2">
              <select 
                className="w-full bg-slate-900 border border-blue-900/50 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                data-testid="select-status-filter"
              >
                <option value="all">All Cases</option>
                <option value="submitted">Submitted</option>
                <option value="under_review">Under Review</option>
                <option value="information_requested">Information Requested</option>
                <option value="dismissed">Dismissed</option>
                <option value="actioned">Actioned</option>
              </select>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-slate-500" data-testid="loading-cases">
                Loading cases...
              </div>
            ) : error ? (
              <div className="p-8 text-center text-sm text-red-400" data-testid="error-cases">
                The queue could not be loaded. Refresh to try again.
              </div>
            ) : cases?.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500" data-testid="empty-cases">
                No cases found in this view.
              </div>
            ) : (
              cases?.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCaseId(c.id)}
                  data-testid={`button-select-case-${c.id}`}
                  className={cn(
                    "w-full text-left p-3 rounded-lg border transition-all duration-200 focus:outline-none",
                    selectedCaseId === c.id 
                      ? "bg-blue-900/20 border-blue-500/50" 
                      : "bg-transparent border-transparent hover:bg-slate-900/50"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs font-medium text-slate-300 truncate mr-2">
                      {c.publicReference}
                    </span>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="text-sm font-medium text-slate-200 truncate">
                    {c.claimantName}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 truncate">
                    {c.rightsType}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden relative">
          {selectedCase ? (
            <CaseDetailView caseData={selectedCase} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500" data-testid="empty-detail-view">
              <Shield className="w-12 h-12 mb-4 opacity-20" />
              <p>Select a case from the queue to review.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
