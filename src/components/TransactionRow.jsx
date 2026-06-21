export default function TransactionRow({ txn, showAccount }) {
  const posted = new Date(txn.posted + 'Z');
  const formattedDate = posted.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });

  return (
    <tr>
      <td style={{ whiteSpace: 'nowrap' }}>{formattedDate}</td>
      {showAccount && (
        <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {txn.account_name}
        </td>
      )}
      <td>{txn.description}</td>
      <td className={`amount ${txn.amount >= 0 ? 'positive' : 'negative'}`}>
        ${Math.abs(txn.amount).toFixed(2)}
      </td>
    </tr>
  );
}
