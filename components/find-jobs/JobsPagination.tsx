"use client";

const PAGE_SIZE = 6;

type Props = {
  page: number;
  totalPages: number;
  totalCount: number;
  startIdx: number;
  pageNumbers: (number | "...")[];
  onPageChange: (page: number) => void;
};

export function JobsPagination({
  page,
  totalPages,
  totalCount,
  startIdx,
  pageNumbers,
  onPageChange,
}: Props) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-border">
      <p className="text-sm text-text-secondary">
        {totalCount === 0 ? (
          "No results"
        ) : (
          <>
            Showing{" "}
            <span className="font-semibold text-text-primary">
              {startIdx + 1}
            </span>{" "}
            to{" "}
            <span className="font-semibold text-text-primary">
              {Math.min(startIdx + PAGE_SIZE, totalCount)}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-text-primary">
              {totalCount}
            </span>{" "}
            results
          </>
        )}
      </p>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="px-3 py-1.5 text-sm rounded-md text-text-primary hover:bg-surface-secondary transition-colors disabled:text-text-muted disabled:cursor-not-allowed"
        >
          Previous
        </button>

        {pageNumbers.map((p, i) =>
          p === "..." ? (
            <span
              key={`ellipsis-${i}`}
              className="px-2 text-sm text-text-muted"
            >
              ...
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p as number)}
              className={`w-8 h-8 text-sm rounded-md transition-colors ${
                page === p
                  ? "bg-accent text-accent-foreground"
                  : "text-text-primary hover:bg-surface-secondary"
              }`}
            >
              {p}
            </button>
          ),
        )}

        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="px-3 py-1.5 text-sm rounded-md text-text-primary hover:bg-surface-secondary transition-colors disabled:text-text-muted disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
