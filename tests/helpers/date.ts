export const withFixedDate = (iso: string, fn: () => void) => {
  const RealDate = Date;
  const MockDate: any = function (...args: any[]) {
    if (args.length === 0) {
      return new RealDate(iso);
    }
    return Reflect.construct(RealDate, args);
  };
  MockDate.now = () => new RealDate(iso).getTime();
  MockDate.prototype = RealDate.prototype;
  (globalThis as any).Date = MockDate;
  try {
    fn();
  } finally {
    (globalThis as any).Date = RealDate;
  }
};
