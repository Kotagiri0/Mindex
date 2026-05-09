export function MysliThinking() {
  return (
    <div className="mysli-thinking">
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g className="outer-circle">
          <circle cx="24" cy="24" r="20" stroke="#111" strokeWidth="2.5" fill="none"/>
        </g>
        <g className="inner-ellipse">
          <ellipse cx="24" cy="24" rx="20" ry="9" stroke="#111" strokeWidth="1.8" fill="none"/>
        </g>
        <g className="inner-ellipse-2">
          <ellipse cx="24" cy="24" rx="20" ry="5" stroke="#111" strokeWidth="1.2" fill="none" opacity="0.4"/>
        </g>
        <g className="pupil">
          <circle cx="24" cy="24" r="6" stroke="#111" strokeWidth="2" fill="none"/>
        </g>
        <circle cx="24" cy="24" r="2" fill="#111" className="center-dot"/>
      </svg>
    </div>
  )
}
