export interface OverallPerformance {
  gmv: number;
  affiliate_gmv: number;
  orders: number;
  samples_approved: number;
  samples_approved_note: string;
  roi: number;
  sps: number;
  videos_posted: number;
  videos_total_note: string;
  offsite_gmv: number;
  tiktok_shop_gmv: number;
  offsite_effect: number;
}

export interface TopCreator   { name: string; videos: number; items_sold: number; gmv: number; notes: string; }
export interface TopVideo     { creator_name: string; video_url: string; items_sold: number; gmv: number; views: number; product_clicks: number; notes: string; }
export interface GmvMaxRow    { campaign: string; spend: number; roi: number; orders: number; cpo: number; gmv: number; notes: string; }
export interface ProductRow   { product_id: string; product_name: string; units_sold: number; gmv: number; new_videos: number; notes: string; }
export interface Insights     { summary: string; bullets: string[]; main_call_out: string; }

export interface WeeklyReportContent {
  overall: OverallPerformance;
  top_creators: TopCreator[];
  top_videos: TopVideo[];
  gmv_max: GmvMaxRow[];
  product_highlights: ProductRow[];
  insights: Insights;
}

export const emptyOverall = (): OverallPerformance => ({
  gmv: 0, affiliate_gmv: 0, orders: 0, samples_approved: 0, samples_approved_note: '',
  roi: 0, sps: 0, videos_posted: 0, videos_total_note: '',
  offsite_gmv: 0, tiktok_shop_gmv: 0, offsite_effect: 0,
});

export const emptyContent = (): WeeklyReportContent => ({
  overall: emptyOverall(),
  top_creators: [],
  top_videos: [],
  gmv_max: [],
  product_highlights: [],
  insights: { summary: '', bullets: [], main_call_out: '' },
});

export const emptyTopCreator = (): TopCreator => ({ name: '', videos: 0, items_sold: 0, gmv: 0, notes: '' });
export const emptyTopVideo   = (): TopVideo   => ({ creator_name: '', video_url: '', items_sold: 0, gmv: 0, views: 0, product_clicks: 0, notes: '' });
export const emptyGmvMax     = (): GmvMaxRow  => ({ campaign: '', spend: 0, roi: 0, orders: 0, cpo: 0, gmv: 0, notes: '' });
export const emptyProduct    = (): ProductRow => ({ product_id: '', product_name: '', units_sold: 0, gmv: 0, new_videos: 0, notes: '' });
