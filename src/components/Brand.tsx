import { Link } from 'react-router-dom';
import { site } from '../config/site';

export function BrandMark({ size = 38 }: { size?: number }) {
  return <img src="/favicon.svg?v=wusan-20261108-v2" width={size} height={size} alt="" />;
}

export function Brand() {
  return <Link className="brand" to="/" aria-label={`${site.name} 首页`}>
    <BrandMark />
    <span className="brand-name">{site.name}<small>让灵感更进一步</small></span>
  </Link>;
}
