"use client";
export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="card stack" role="alert">
      <h1>暂时无法读取数据</h1>
      <p>
        请检查网络后重试。为避免误判，读取失败时不会显示为“没有记录”或余额为 0。
      </p>
      <button className="btn btn-primary" onClick={reset}>
        重新读取
      </button>
    </section>
  );
}
