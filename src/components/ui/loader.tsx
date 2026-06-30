import React from "react";

const Loader: React.FC = () => {
  return (
    <div
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      role="status"
      aria-label="Analyzing report"
    >
      <div className="tb-goo-loader m-auto h-[200px] w-[200px] animate-[rotate-move_2s_ease-in-out_infinite]">
        <div className="dot dot-1 absolute bottom-0 left-0 right-0 top-0 m-auto h-[70px] w-[70px] rounded-full bg-[#ffc400]" />
        <div className="dot dot-2 absolute bottom-0 left-0 right-0 top-0 m-auto h-[70px] w-[70px] rounded-full bg-[#0051ff]" />
        <div className="dot dot-3 absolute bottom-0 left-0 right-0 top-0 m-auto h-[70px] w-[70px] rounded-full bg-[#ff1717]" />

        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" className="hidden">
          <defs>
            <filter id="goo">
              <feGaussianBlur result="blur" stdDeviation={10} in="SourceGraphic" />
              <feColorMatrix
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 21 -7"
                mode="matrix"
                in="blur"
              />
            </filter>
          </defs>
        </svg>
      </div>
    </div>
  );
};

export default Loader;
