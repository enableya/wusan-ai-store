import { Link } from 'react-router-dom';
import { site } from '../config/site';

export function Brand() {
  return <Link className="brand" to="/" aria-label={`${site.name} 首页`}>
    <img src="/favicon.svg" width={38} height={38} alt="" />
    <span className="brand-name">{site.name}<small>让灵感更进一步</small></span>
  </Link>;
}
