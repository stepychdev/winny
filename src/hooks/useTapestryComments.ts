import { useCallback, useEffect, useState } from "react";
import { ENABLE_TAPESTRY_SOCIAL } from "../lib/constants";
import { fetchComments, createComment, deleteComment } from "../lib/tapestry/api";
import type { TapestryComment } from "../lib/tapestry/types";

export function useTapestryComments(
  contentId: string | null | undefined,
  requestingProfileId?: string,
) {
  const cleanId = typeof contentId === "string" ? contentId.trim() : "";
  const [comments, setComments] = useState<TapestryComment[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!ENABLE_TAPESTRY_SOCIAL || !cleanId) return;
    fetchComments(cleanId, requestingProfileId)
      .then(setComments)
      .catch(() => {/* soft fail */});
  }, [cleanId, requestingProfileId]);

  useEffect(() => {
    let cancelled = false;

    if (!ENABLE_TAPESTRY_SOCIAL || !cleanId) {
      setComments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchComments(cleanId, requestingProfileId)
      .then((next) => { if (!cancelled) setComments(next); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [cleanId, requestingProfileId]);

  const addComment = useCallback(
    async (wallet: string, text: string, commentId?: string) => {
      if (!cleanId) throw new Error("contentId is required");
      const created = await createComment(wallet, cleanId, text, commentId);
      refresh();
      return created;
    },
    [cleanId, refresh],
  );

  const removeComment = useCallback(
    async (commentId: string) => {
      await deleteComment(commentId);
      refresh();
    },
    [refresh],
  );

  return { comments, loading, refresh, addComment, removeComment };
}
