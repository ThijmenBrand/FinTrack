import Link from "next/link";

type Props = {
  category?: string;
  account?: string;
  type?: string;
  period?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  className?: string;
  children: React.ReactNode;
};

export function TransactionsFilterLink({
  category,
  account,
  type,
  period,
  dateFrom,
  dateTo,
  search,
  className,
  children,
}: Props) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (account && account !== "all") params.set("account", account);
  if (category && category !== "all") params.set("category", category);
  if (type && type !== "all") params.set("type", type);
  if (period && period !== "all") params.set("period", period);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);

  const qs = params.toString();
  const href = qs ? `/transactions?${qs}` : "/transactions";

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
