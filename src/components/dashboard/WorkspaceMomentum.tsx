type MomentumProps = {
  current: number;
  target: number;
  memberCount: number;
  personal: boolean;
};

function formatMoney(value: number) {
  return `£${Math.round(value).toLocaleString()}`;
}

export function WorkspaceMomentum({ current, target, memberCount, personal }: MomentumProps) {
  const progress = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  return (
    <section
      className="relative isolate min-h-[270px] overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(120deg,#10131b_0%,#171d2c_48%,#241629_100%)] px-6 py-7 text-white shadow-[0_28px_80px_rgba(22,18,35,.16)] sm:min-h-[290px] sm:px-10 sm:py-9 lg:min-h-[300px] lg:px-12"
      aria-label={`${personal ? "Personal" : "Team"} momentum: ${progress}% of goal`}
    >
      <div
        aria-hidden="true"
        className="tb-momentum-orbit pointer-events-none absolute -right-16 -top-28 h-[27rem] w-[27rem] rounded-full border border-fun-blue/20 sm:-right-6 sm:h-[31rem] sm:w-[31rem]"
      >
        <span className="absolute left-12 top-14 h-9 w-9 rounded-full bg-gradient-to-br from-[#9ce7ff] to-[#80a8ff] shadow-[0_0_55px_rgba(127,214,255,.55)]" />
      </div>
      <div
        aria-hidden="true"
        className="tb-momentum-glow pointer-events-none absolute -bottom-64 -right-20 h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgba(255,134,177,.26),rgba(255,134,177,0)_68%)]"
      />

      <div className="tb-momentum-copy relative z-10 max-w-[48rem] pr-28 sm:pr-44">
        <div className="text-xs font-extrabold uppercase tracking-[0.22em] text-white/60 sm:text-sm">
          {personal ? "Your momentum" : "Team momentum"}
        </div>
        <h2 className="mt-3 text-3xl font-black leading-[0.98] tracking-[-0.045em] sm:text-4xl lg:text-5xl">
          Keep the streak moving.
        </h2>
        <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-white/60 sm:text-base">
          Live progress from the workspace, turned into one clear daily pulse.
        </p>
      </div>

      <div className="tb-momentum-badge absolute right-5 top-5 z-10 flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 text-xs font-black text-[#131722] shadow-sm sm:right-8 sm:top-8 sm:px-4 sm:text-sm">
        <span className="h-2.5 w-2.5 rounded-full bg-fun-lime shadow-[0_0_18px_rgba(166,240,77,.7)]" />
        {memberCount} active member{memberCount === 1 ? "" : "s"}
      </div>

      <div className="absolute bottom-6 left-6 right-6 z-10 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 sm:bottom-8 sm:left-10 sm:right-auto sm:w-[min(49rem,calc(100%-5rem))] sm:gap-5 sm:px-5 lg:left-12 lg:w-[49rem]">
        <strong className="shrink-0 text-2xl font-black leading-none sm:text-3xl">
          {progress}%
        </strong>
        <div className="h-2.5 min-w-12 flex-1 overflow-hidden rounded-full bg-white/10 sm:h-3">
          <div
            className="tb-momentum-progress h-full origin-left rounded-full bg-gradient-to-r from-fun-lime via-fun-yellow to-fun-orange"
            style={{ width: `${progress}%` }}
          />
        </div>
        <strong className="shrink-0 whitespace-nowrap text-xs font-extrabold sm:text-sm">
          {formatMoney(current)} / {formatMoney(target)}
        </strong>
      </div>
    </section>
  );
}
