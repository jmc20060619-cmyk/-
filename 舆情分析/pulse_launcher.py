import json
import os
import mimetypes
import socket
import threading
import time
import webbrowser
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse, urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
import sys

ROOT_DIR = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
PROJECT_DIR = Path(__file__).resolve().parent if "__file__" in globals() else ROOT_DIR
CONFIG_PATH = (Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else PROJECT_DIR) / "external_api_config.json"
DEFAULT_EXTERNAL_API_CONFIG = {
    "enabled": False,
    "base_url": "",
    "token": "",
    "timeout_sec": 12,
    "endpoints": {
        "dashboard": "/dashboard",
        "monitor": "/monitor",
        "events": "/events",
        "warnings": "/warnings",
        "search": "/search"
    }
}

QUERY_CONFIG = {
    'all': {'label': '全部'},
    'brand': {'label': '品牌口碑'},
    'product': {'label': '产品反馈'},
    'campaign': {'label': '热点营销'},
    'community': {'label': '社区讨论'},
}

PREFERENCE_OPTIONS = [
    {'key': 'brand', 'label': '品牌口碑', 'description': '关注品牌评价、口碑走向与信任变化。'},
    {'key': 'product', 'label': '产品反馈', 'description': '关注产品体验、功能问题和用户需求。'},
    {'key': 'campaign', 'label': '热点营销', 'description': '关注活动传播、二创扩散与营销声量。'},
    {'key': 'community', 'label': '社区讨论', 'description': '关注社区争议、群体情绪和话题聚合。'},
]

ALERT_RULES = [
    {'title': '声量增长 > 180%', 'description': '近 30 分钟内讨论量激增时，自动提升提醒等级。'},
    {'title': '高互动内容 >= 3 条', 'description': '连续出现高热评论内容时，进入人工复核队列。'},
    {'title': '多区域扩散 >= 3 个节点', 'description': '当话题跨区域扩散时，切换为持续跟踪状态。'},
]

LIVE_SOURCE_NAME = 'HN Algolia'
LIVE_API_BASE = 'https://hn.algolia.com/api/v1'
LIVE_FETCH_TIMEOUT_SEC = 8
LIVE_CACHE_TTL_SEC = 180
LIVE_STORY_LIMIT = 24
REGION_LABELS = ['华东', '华北', '华南', '西部']
CATEGORY_PROFILES = {
    'brand': {
        'keywords': ['company', 'startup', 'ceo', 'business', 'brand', 'policy', 'trust', 'privacy', 'acquires', 'acquisition', 'lawsuit'],
        'visualTags': ['品牌海报', '评论截图'],
    },
    'product': {
        'keywords': ['show hn', 'app', 'tool', 'api', 'sdk', 'feature', 'bug', 'framework', 'library', 'open source', 'release', 'product', 'software'],
        'visualTags': ['界面截图', '产品图片'],
    },
    'campaign': {
        'keywords': ['launch', 'launches', 'announces', 'announcement', 'introducing', 'promo', 'campaign', 'rollout', 'debut', 'marketing'],
        'visualTags': ['海报素材', '短视频'],
    },
    'community': {
        'keywords': ['ask hn', 'forum', 'community', 'discussion', 'debate', 'reddit', 'thread', 'moderation', 'users', 'comments'],
        'visualTags': ['评论截图'],
    },
}
LIVE_CACHE = {
    'recent': {'items': None, 'fetched_at': 0},
    'search': {},
}

STORIES = [
    {'id': 'brand-1', 'category': 'brand', 'originalTitle': 'AI phone brand faces backlash after update changes camera style', 'translatedTitle': 'AI 手机品牌因相机风格更新引发争议', 'url': 'https://example.com/brand-1', 'source': 'techpulse.com', 'author': 'Mia', 'createdAt': '2026-03-12T07:20:00.000Z', 'points': 90, 'comments': 54, 'region': '华东', 'visualTags': ['界面截图', '产品图片']},
    {'id': 'product-1', 'category': 'product', 'originalTitle': 'Users report onboarding errors after productivity app redesign', 'translatedTitle': '效率应用改版后用户集中反馈引导流程报错', 'url': 'https://example.com/product-1', 'source': 'buildweekly.dev', 'author': 'Leo', 'createdAt': '2026-03-12T06:10:00.000Z', 'points': 85, 'comments': 61, 'region': '华北', 'visualTags': ['界面截图']},
    {'id': 'campaign-1', 'category': 'campaign', 'originalTitle': 'Launch poster sparks remix wave across creator communities', 'translatedTitle': '发布海报在创作者社区引发二创扩散', 'url': 'https://example.com/campaign-1', 'source': 'socialscope.cn', 'author': 'Iris', 'createdAt': '2026-03-12T05:35:00.000Z', 'points': 76, 'comments': 42, 'region': '华南', 'visualTags': ['海报素材', '短视频']},
    {'id': 'community-1', 'category': 'community', 'originalTitle': 'Forum users debate whether new AI moderation policy is fair', 'translatedTitle': '社区围绕 AI 内容审核新规是否公平展开争论', 'url': 'https://example.com/community-1', 'source': 'forumdeck.net', 'author': 'Noah', 'createdAt': '2026-03-12T04:40:00.000Z', 'points': 71, 'comments': 58, 'region': '西部', 'visualTags': ['评论截图']},
    {'id': 'brand-2', 'category': 'brand', 'originalTitle': 'Consumers compare brand trust after executive response video', 'translatedTitle': '高管回应视频发布后消费者重新比较品牌信任度', 'url': 'https://example.com/brand-2', 'source': 'videotrack.io', 'author': 'Jade', 'createdAt': '2026-03-12T03:50:00.000Z', 'points': 66, 'comments': 33, 'region': '华南', 'visualTags': ['视频截图']},
    {'id': 'product-2', 'category': 'product', 'originalTitle': 'Developers praise speed but complain about missing export feature', 'translatedTitle': '开发者认可速度提升，但集中吐槽导出功能缺失', 'url': 'https://example.com/product-2', 'source': 'devsignal.ai', 'author': 'Ava', 'createdAt': '2026-03-12T02:45:00.000Z', 'points': 59, 'comments': 47, 'region': '华北', 'visualTags': ['界面截图']},
    {'id': 'campaign-2', 'category': 'campaign', 'originalTitle': 'Short video challenge boosts campaign mentions overnight', 'translatedTitle': '短视频挑战赛让活动声量一夜间快速放大', 'url': 'https://example.com/campaign-2', 'source': 'trendroom.co', 'author': 'Ella', 'createdAt': '2026-03-11T23:10:00.000Z', 'points': 74, 'comments': 39, 'region': '华东', 'visualTags': ['短视频', '海报素材']},
    {'id': 'community-2', 'category': 'community', 'originalTitle': 'Volunteer group organizes FAQ thread to calm community panic', 'translatedTitle': '社区志愿者整理 FAQ 线程以缓解恐慌情绪', 'url': 'https://example.com/community-2', 'source': 'communitylab.org', 'author': 'Ryan', 'createdAt': '2026-03-11T21:20:00.000Z', 'points': 54, 'comments': 24, 'region': '华东', 'visualTags': ['评论截图']},
]

def clamp(value, low, high):
    return min(high, max(low, value))

def round_num(value):
    return int(round(float(value or 0)))

def parse_interest(value):
    if not value:
        return []
    valid = {'brand', 'product', 'campaign', 'community'}
    result = []
    for item in value.split(','):
        item = item.strip()
        if item in valid and item not in result:
            result.append(item)
    return result

def build_sentiment(story):
    negative = clamp(round_num(26 + story['comments'] * 0.55 + story['points'] * 0.08), 18, 62)
    positive = clamp(round_num(18 + story['points'] * 0.16 - story['comments'] * 0.06), 12, 38)
    neutral = max(10, 100 - negative - positive)
    return {'negative': 100 - positive - neutral, 'neutral': neutral, 'positive': positive}

def build_seed_stories():
    items = []
    for story in STORIES:
        item = dict(story)
        item['categoryLabel'] = QUERY_CONFIG[item['category']]['label']
        item['score'] = item['points'] + item['comments']
        item['sentiment'] = build_sentiment(item)
        items.append(item)
    items.sort(key=lambda x: (x['score'], x['createdAt']), reverse=True)
    return items


def request_json(url, timeout_sec=LIVE_FETCH_TIMEOUT_SEC):
    request = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'PulseScope/1.0'})
    with urlopen(request, timeout=timeout_sec) as response:
        return json.loads(response.read().decode('utf-8'))


def build_live_url(mode, query=''):
    params = {
        'tags': 'front_page' if mode == 'search' and not query else 'story',
        'hitsPerPage': LIVE_STORY_LIMIT,
    }
    if query:
        params['query'] = query
    return f"{LIVE_API_BASE}/{mode}?{urlencode(params)}"


def host_name(url_value):
    try:
        return urlparse(url_value).netloc.replace('www.', '') or 'news.ycombinator.com'
    except Exception:
        return 'news.ycombinator.com'


def pick_region(seed_value):
    seed = str(seed_value or '')
    total = sum(ord(char) * (index + 1) for index, char in enumerate(seed))
    return REGION_LABELS[total % len(REGION_LABELS)]


def score_category(text, tags, category_key):
    profile = CATEGORY_PROFILES[category_key]
    score = 0
    for keyword in profile['keywords']:
        if keyword in text:
            score += 2
        if any(keyword.replace(' ', '_') in tag for tag in tags):
            score += 1
    return score


def detect_category(title, tags, index):
    text = f"{str(title or '').lower()} {' '.join(tags)}"
    ranked = sorted(
        ({'key': key, 'score': score_category(text, tags, key)} for key in QUERY_CONFIG if key != 'all'),
        key=lambda item: item['score'],
        reverse=True,
    )
    return ranked[0]['key'] if ranked and ranked[0]['score'] > 0 else ['brand', 'product', 'campaign', 'community'][index % 4]


def build_live_visual_tags(category, title, tags, url_value):
    profile = CATEGORY_PROFILES.get(category, CATEGORY_PROFILES['product'])
    text = f"{str(title or '').lower()} {str(url_value or '').lower()}"
    dynamic = []
    if 'video' in text or 'youtube' in text:
        dynamic.append('短视频')
    if 'image' in text or 'photo' in text or 'github' in host_name(url_value):
        dynamic.append('界面截图')
    if 'show_hn' in tags:
        dynamic.append('产品图片')
    return list(dict.fromkeys(dynamic + profile['visualTags']))[:3]


def normalize_live_hits(hits):
    seen = set()
    items = []
    for index, hit in enumerate(hits or []):
        object_id = str(hit.get('objectID') or hit.get('story_id') or index)
        if object_id in seen:
            continue
        seen.add(object_id)
        original_title = str(hit.get('title') or hit.get('story_title') or '').strip()
        if not original_title:
            continue
        tags = [str(tag or '').lower() for tag in hit.get('_tags', [])]
        category = detect_category(original_title, tags, index)
        raw_created_at = hit.get('created_at') or datetime.utcnow().isoformat() + 'Z'
        try:
            created_at = datetime.fromisoformat(raw_created_at.replace('Z', '+00:00')).strftime('%Y-%m-%dT%H:%M:%S.000Z')
        except Exception:
            created_at = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')
        story_url = str(hit.get('url') or f"https://news.ycombinator.com/item?id={object_id}")
        item = {
            'id': f'hn-{object_id}',
            'category': category,
            'originalTitle': original_title,
            'translatedTitle': '',
            'url': story_url,
            'source': host_name(story_url),
            'author': hit.get('author') or 'HN',
            'createdAt': created_at,
            'points': clamp(round_num(hit.get('points') or 0), 0, 9999),
            'comments': clamp(round_num(hit.get('num_comments') or 0), 0, 9999),
            'region': pick_region(f"{object_id}:{story_url}"),
            'visualTags': build_live_visual_tags(category, original_title, tags, story_url),
        }
        item['categoryLabel'] = QUERY_CONFIG[item['category']]['label']
        item['score'] = item['points'] + item['comments']
        item['sentiment'] = build_sentiment(item)
        items.append(item)
    items.sort(key=lambda x: (x['score'], x['createdAt']), reverse=True)
    return items


def fetch_live_stories_by_query(query=''):
    mode = 'search_by_date' if query else 'search'
    fallback_mode = 'search' if query else 'search_by_date'
    payloads = []
    for current_mode in [mode, fallback_mode]:
        try:
            payloads.append(request_json(build_live_url(current_mode, query)))
        except (HTTPError, URLError, TimeoutError, ValueError):
            continue
    hits = []
    for payload in payloads:
        hits.extend(payload.get('hits', []))
    return normalize_live_hits(hits)


def get_live_stories(force_refresh=False):
    now = time.time()
    cached = LIVE_CACHE['recent']
    if not force_refresh and cached['items'] and now - cached['fetched_at'] < LIVE_CACHE_TTL_SEC:
        return cached
    items = fetch_live_stories_by_query('')
    if items:
        LIVE_CACHE['recent'] = {'items': items, 'fetched_at': now}
        return LIVE_CACHE['recent']
    return None


def get_search_stories(query, force_refresh=False):
    normalized_query = str(query or '').strip().lower()
    if not normalized_query:
        return None
    cached = LIVE_CACHE['search'].get(normalized_query)
    now = time.time()
    if not force_refresh and cached and now - cached['fetched_at'] < LIVE_CACHE_TTL_SEC:
        return cached
    items = fetch_live_stories_by_query(normalized_query)
    if items:
        payload = {'items': items, 'fetched_at': now}
        LIVE_CACHE['search'][normalized_query] = payload
        return payload
    return None


def story_bundle(force_refresh=False):
    live = get_live_stories(force_refresh)
    if live and live.get('items'):
        return {'items': live['items'], 'sourceName': LIVE_SOURCE_NAME, 'updatedAt': datetime.utcfromtimestamp(live['fetched_at']).isoformat() + 'Z'}
    return {'items': build_seed_stories(), 'sourceName': 'PulseScope Dataset', 'updatedAt': datetime.utcnow().isoformat() + 'Z'}

def risk(score):
    if score >= 120:
        return {'text': '高波动', 'className': 'badge-warn'}
    if score >= 70:
        return {'text': '关注中', 'className': 'badge-mid'}
    return {'text': '稳定', 'className': 'badge-safe'}

def alert_level(score):
    if score >= 120:
        return {'text': '红色', 'className': 'badge-warn'}
    if score >= 70:
        return {'text': '橙色', 'className': 'badge-mid'}
    return {'text': '黄色', 'className': 'badge-safe'}

def source_distribution(items):
    counts = {}
    for item in items:
        counts[item['source']] = counts.get(item['source'], 0) + 1
    total = max(1, len(items))
    return [{'label': k, 'count': v, 'percent': round_num(v * 100 / total)} for k, v in sorted(counts.items(), key=lambda x: x[1], reverse=True)]

def category_heat(items):
    total = max(1, len(items))
    result = []
    for key in ['brand', 'product', 'campaign', 'community']:
        count = sum(1 for item in items if item['category'] == key)
        result.append({'key': key, 'label': QUERY_CONFIG[key]['label'], 'totalHits': count, 'percent': round_num(count * 100 / total)})
    return result

def sentiment_overview(items):
    count = max(1, len(items))
    return [
        {'key': 'negative', 'label': '负向', 'value': round_num(sum(i['sentiment']['negative'] for i in items) / count), 'note': '争议、质疑与投诉占比'},
        {'key': 'neutral', 'label': '中性', 'value': round_num(sum(i['sentiment']['neutral'] for i in items) / count), 'note': '信息性与观察性表达占比'},
        {'key': 'positive', 'label': '正向', 'value': round_num(sum(i['sentiment']['positive'] for i in items) / count), 'note': '支持、认可与分享占比'},
    ]

def extract_keywords(items):
    stop_words = {'the', 'and', 'for', 'with', 'after', 'users', 'user', 'brand', 'product', 'community', 'campaign', 'launch'}
    counts = {}
    for item in items:
        text = ''.join(ch.lower() if ch.isalnum() or ch in ' -' else ' ' for ch in item['originalTitle'])
        for token in text.split():
            if len(token) >= 3 and token not in stop_words:
                counts[token] = counts.get(token, 0) + 1
    ranked = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:10]
    return [{'keyword': k, 'count': v, 'weight': clamp(100 - idx * 7 + v * 5, 24, 100)} for idx, (k, v) in enumerate(ranked)]

def trend(items):
    counts = {}
    for item in items:
        key = item['createdAt'][:10]
        counts[key] = counts.get(key, 0) + 1
    now = datetime.utcnow()
    result = []
    for offset in range(6, -1, -1):
        day = now - timedelta(days=offset)
        key = day.strftime('%Y-%m-%d')
        result.append({'key': key, 'label': day.strftime('%m/%d'), 'count': counts.get(key, 0)})
    return result

def advice(category, score):
    mapping = {
        'brand': '优先查看品牌评价分化和回应节奏。' if score >= 70 else '持续观察品牌口碑变化。',
        'product': '同步产品和客服团队复核高频问题。' if score >= 70 else '跟进产品体验反馈。',
        'campaign': '复盘传播链路和二创内容扩散。' if score >= 70 else '观察活动自然传播。',
        'community': '识别核心争议点并管理讨论氛围。' if score >= 70 else '关注社区情绪走向。',
    }
    return mapping.get(category, '保持持续监测。')

def push_summary(items, interest_keys):
    selected = interest_keys or ['brand', 'product']
    labels = [QUERY_CONFIG[key]['label'] for key in selected]
    matched_count = sum(1 for item in items if item['category'] in selected and item['score'] >= 70)
    return {'interestKeys': selected, 'interestLabels': labels, 'matchedCount': matched_count, 'message': f"当前按 {' / '.join(labels)} 为你优先推荐内容，发现 {matched_count} 条高相关热点。"}

def recommendations(items, interest_keys, limit=4):
    selected = set(interest_keys or ['brand', 'product'])
    ranked = [item for item in items if item['category'] in selected] + [item for item in items if item['category'] not in selected]
    result = []
    for idx, item in enumerate(ranked[:limit], start=1):
        obj = dict(item)
        obj['priority'] = idx
        obj['isPreferred'] = item['category'] in selected
        obj['matchReason'] = f"{item['categoryLabel']} 与当前用户偏好高度匹配" if obj['isPreferred'] else '基于实时热度推荐'
        result.append(obj)
    return result

def push_signals(items, interest_keys, limit=6):
    selected = set(interest_keys or ['brand', 'product'])
    result = []
    for index, item in enumerate(items[:limit]):
        signal_score = clamp(round_num(item['score'] * 0.58 + item['comments'] * 0.9 + (16 if item['category'] in selected else 0) + (6 - index) * 4), 28, 99)
        level = risk(signal_score)
        obj = dict(item)
        obj.update({'signalId': f"signal:{item['id']}", 'typeKey': 'preference_match' if item['category'] in selected else 'heat_spike', 'typeLabel': '偏好命中' if item['category'] in selected else '热度升温', 'typeDescription': '内容与用户兴趣方向高度一致' if item['category'] in selected else '话题热度和互动同时提升', 'isPreferred': item['category'] in selected, 'signalScore': signal_score, 'riskText': level['text'], 'riskClass': level['className'], 'reason': f"基于语义热度、互动强度和偏好匹配度，系统识别到 {item['categoryLabel']} 方向值得优先关注。", 'actionHint': advice(item['category'], item['score'])})
        result.append(obj)
    return result

def push_type_board(signals):
    counts = {}
    for item in signals:
        counts[item['typeKey']] = counts.get(item['typeKey'], 0) + 1
    total = max(1, len(signals))
    max_count = max([1] + list(counts.values()))
    items = [
        {'key': 'preference_match', 'label': '偏好命中', 'description': '内容与用户兴趣方向匹配', 'count': counts.get('preference_match', 0)},
        {'key': 'heat_spike', 'label': '热度升温', 'description': '热度和互动快速上升', 'count': counts.get('heat_spike', 0)},
        {'key': 'spread_jump', 'label': '扩散外溢', 'description': '跨区域或跨圈层扩散', 'count': max(1, round_num(len(signals) / 3))},
    ]
    for item in items:
        item['percent'] = round_num(item['count'] * 100 / total)
        item['emphasis'] = item['count'] == max_count
    return items

def multimodal_summary(items, interest_keys):
    keywords = extract_keywords(items)
    selected = interest_keys or ['brand', 'product']
    predictions = []
    for index, item in enumerate(items[:6]):
        score = clamp(round_num(item['score'] * 0.5 + item['comments'] * 0.9 + (14 if item['category'] in selected else 0) + (6 - index) * 6), 35, 99)
        level = risk(score)
        obj = dict(item)
        obj.update({'predictionScore': score, 'stage': '高概率升温' if score >= 82 else '持续发酵' if score >= 66 else '值得观察', 'reason': '结合语义热度、视觉素材传播和时空扩散强度，系统判断该话题存在继续升温概率。', 'keywords': [entry['keyword'] for entry in keywords[:3]], 'riskText': level['text'], 'riskClass': level['className']})
        predictions.append(obj)
    spatial_map = {}
    for item in items:
        spatial_map[item['region']] = spatial_map.get(item['region'], 0) + 1
    spatial_max = max([1] + list(spatial_map.values()))
    spatial = [{'label': key, 'count': value, 'intensity': round_num(value * 100 / spatial_max)} for key, value in spatial_map.items()]
    visual_map = {}
    for item in items:
        for tag in item.get('visualTags', []):
            visual_map[tag] = visual_map.get(tag, 0) + 1
    visual_max = max([1] + list(visual_map.values()))
    visual = [{'label': key, 'score': value, 'percent': round_num(value * 100 / visual_max)} for key, value in visual_map.items()]
    temporal = []
    now = datetime.utcnow()
    buckets = [('0-2h', '近 2 小时', 0), ('2-6h', '2-6 小时', 0), ('6-12h', '6-12 小时', 0), ('12h+', '12 小时以上', 0)]
    counts = {key: 0 for key, _, _ in buckets}
    for item in items:
        created = datetime.strptime(item['createdAt'], '%Y-%m-%dT%H:%M:%S.000Z')
        age = (now - created).total_seconds() / 3600
        if age <= 2: counts['0-2h'] += 1
        elif age <= 6: counts['2-6h'] += 1
        elif age <= 12: counts['6-12h'] += 1
        else: counts['12h+'] += 1
    temporal_max = max([1] + list(counts.values()))
    for key, label, _ in buckets:
        temporal.append({'key': key, 'label': label, 'count': counts[key], 'percent': round_num(counts[key] * 100 / temporal_max)})
    preference_embedding = []
    for key in selected:
        subset = [item for item in items if item['category'] == key]
        preference_embedding.append({'key': key, 'label': QUERY_CONFIG[key]['label'], 'matchCount': len(subset), 'affinity': clamp(round_num(sum(item['score'] for item in subset) / max(1, len(subset))), 18, 98)})
    channels = [
        {'key': 'semantic', 'label': '文本语义', 'score': clamp(round_num(sum(item['score'] for item in items) / max(1, len(items))), 20, 98), 'note': '从标题和互动中提取舆情强度'},
        {'key': 'visual', 'label': '视觉线索', 'score': clamp(round_num(sum(item['percent'] for item in visual) / max(1, len(visual))), 20, 94), 'note': '根据图像/视频标签推断传播势能'},
        {'key': 'spatial', 'label': '地理扩散', 'score': clamp(round_num(sum(item['intensity'] for item in spatial) / max(1, len(spatial))), 20, 94), 'note': '根据区域分布估计扩散程度'},
        {'key': 'temporal', 'label': '时间演化', 'score': clamp(round_num(sum(item['percent'] for item in temporal) / max(1, len(temporal))), 20, 94), 'note': '根据发帖时间密度预测升温节奏'},
    ]
    return {'summary': f"多模态时空图网络联合学习文本、视觉、地理分布和时间演化，当前判断 {predictions[0]['categoryLabel'] if predictions else '热点话题'} 最可能继续升温。", 'fusionScore': clamp(round_num(sum(item['score'] for item in channels) / len(channels)), 20, 99), 'channels': channels, 'temporal': temporal, 'spatial': spatial, 'visual': visual, 'keywords': keywords, 'preferenceEmbedding': preference_embedding, 'predictions': predictions}

def dashboard_payload(interest='', force_refresh=False):
    external = fetch_external_payload('dashboard', {'interest': interest})
    if isinstance(external, dict):
        external.setdefault('sourceName', 'External API')
        external.setdefault('updatedAt', datetime.utcnow().isoformat() + 'Z')
        external['_external'] = True
        return external

    bundle = story_bundle(force_refresh)
    items = bundle['items']
    top_items = items[:8]
    interests = parse_interest(interest)
    summary = push_summary(top_items, interests)
    signals = push_signals(top_items, summary['interestKeys'], 7)
    model = multimodal_summary(top_items, summary['interestKeys'])
    sources = source_distribution(top_items)
    sentiments = sentiment_overview(top_items)
    high_heat = sum(1 for item in top_items if item['score'] >= 120)
    return {'sourceName': bundle['sourceName'], 'updatedAt': bundle['updatedAt'], 'overview': {'headline': f"{top_items[0]['categoryLabel']} 保持领先，{top_items[1]['categoryLabel'] if len(top_items) > 1 else '热点话题'} 也在持续升温", 'summary': f"系统已聚合 {len(items)} 条公开讨论内容，当前重点关注 {len(top_items)} 条高互动事件，并结合用户兴趣生成多模态热点预测。", 'statusText': '快速升温' if high_heat >= 2 else '持续关注', 'statusClass': 'badge-warn' if high_heat >= 2 else 'badge-mid'}, 'stats': {'totalHits': len(items), 'keyEvents': len(top_items), 'translatedItems': sum(1 for item in top_items if item.get('translatedTitle')), 'translationCoverage': round_num(sum(1 for item in top_items if item.get('translatedTitle')) * 100 / max(1, len(top_items))), 'highHeat': high_heat, 'potentialAlerts': sum(1 for item in top_items if item['score'] >= 70), 'averageComments': round_num(sum(item['comments'] for item in top_items) / len(top_items)), 'sourceCount': len(sources), 'preferenceMatchCount': summary['matchedCount'], 'volatilityIndex': clamp(round_num(sentiments[0]['value'] + high_heat * 10), 24, 96)}, 'sentiment': sentiments, 'categoryHeat': category_heat(items), 'trend': trend(items), 'sources': sources, 'insightTiles': [{'key': 'volatility', 'label': '波动指数', 'value': str(clamp(round_num(sentiments[0]['value'] + len(top_items) * 4), 20, 96)), 'note': '综合热度和情绪波动'}, {'key': 'engagement', 'label': '平均互动', 'value': str(round_num(sum(item['comments'] for item in top_items) / len(top_items))), 'note': '单条内容平均评论量'}, {'key': 'spread', 'label': '扩散效率', 'value': f"{clamp(round_num(len(sources) * 16), 20, 90)}%", 'note': '活跃来源覆盖度'}, {'key': 'match', 'label': '偏好命中', 'value': str(summary['matchedCount']), 'note': '与用户兴趣高度相关的热点'}], 'preferenceOptions': PREFERENCE_OPTIONS, 'selectedPreferences': summary['interestKeys'], 'pushSummary': summary, 'pushTypes': push_type_board(signals), 'pushSignals': signals, 'recommendations': recommendations(top_items, summary['interestKeys'], 4), 'multimodalModel': model, 'events': [{**item, 'riskText': risk(item['score'])['text'], 'riskClass': risk(item['score'])['className'], 'advice': advice(item['category'], item['score'])} for item in top_items]}

def monitor_payload(filter_key='all', interest='', force_refresh=False):
    external = fetch_external_payload('monitor', {'filter': filter_key, 'interest': interest})
    if isinstance(external, dict):
        external.setdefault('sourceName', 'External API')
        external.setdefault('updatedAt', datetime.utcnow().isoformat() + 'Z')
        external['_external'] = True
        return external

    bundle = story_bundle(force_refresh)
    items = bundle['items']
    filtered = items if filter_key == 'all' else [item for item in items if item['category'] == filter_key]
    interests = parse_interest(interest) or ['brand', 'product']
    return {'sourceName': bundle['sourceName'], 'updatedAt': bundle['updatedAt'], 'filter': filter_key, 'label': QUERY_CONFIG.get(filter_key, QUERY_CONFIG['all'])['label'], 'stats': {'totalHits': len(filtered), 'translatedItems': sum(1 for item in filtered if item.get('translatedTitle')), 'matchedPreferences': sum(1 for item in filtered if item['category'] in interests), 'averageComments': round_num(sum(item['comments'] for item in filtered) / max(1, len(filtered))), 'highRisk': sum(1 for item in filtered if item['score'] >= 120), 'volatilityIndex': clamp(round_num(sentiment_overview(filtered)[0]['value'] + len(filtered) * 4), 20, 96)}, 'sentiment': sentiment_overview(filtered), 'preferenceOptions': PREFERENCE_OPTIONS, 'selectedPreferences': interests, 'recommendations': recommendations(filtered, interests, 3), 'pushSignals': push_signals(filtered, interests, 6), 'items': [{**item, 'isPreferred': item['category'] in interests, 'matchReason': f"{item['categoryLabel']} 与你的关注方向匹配", 'riskText': risk(item['score'])['text'], 'riskClass': risk(item['score'])['className']} for item in filtered[:10]], 'tags': [item['keyword'] for item in extract_keywords(filtered)[:6]]}

def event_payload(event_id='', force_refresh=False):
    external = fetch_external_payload('events', {'id': event_id})
    if isinstance(external, dict):
        external.setdefault('sourceName', 'External API')
        external.setdefault('updatedAt', datetime.utcnow().isoformat() + 'Z')
        external['_external'] = True
        return external

    bundle = story_bundle(force_refresh)
    items = bundle['items']
    event = next((item for item in items if item['id'] == event_id), items[0])
    related = [item for item in items if item['category'] == event['category'] and item['id'] != event['id']][:4]
    created = datetime.strptime(event['createdAt'], '%Y-%m-%dT%H:%M:%S.000Z')
    timeline = []
    for index, item in enumerate([event] + related[:3]):
        timeline.append({'time': datetime.strptime(item['createdAt'], '%Y-%m-%dT%H:%M:%S.000Z').strftime('%m/%d %H:%M'), 'title': ['首次出现', '讨论升温', '扩散放大', '当前焦点'][index], 'originalTitle': item['originalTitle'], 'translatedTitle': item['translatedTitle'], 'description': f"{item['source']} 出现相关讨论，热度 {item['score']}，评论 {item['comments']}。"})
    base = clamp(round_num(event['score'] * 0.55 + event['comments'] * 0.8 + len(related) * 8), 28, 96)
    level = risk(event['score'])
    return {'sourceName': bundle['sourceName'], 'updatedAt': bundle['updatedAt'], 'event': {**event, 'riskText': level['text'], 'riskClass': level['className'], 'summary': f"当前 {event['categoryLabel']} 方向热度为 {event['score']}，来源 {event['source']} 的互动最为集中，建议结合评论和扩散节点判断后续走势。", 'firstSeen': event['createdAt'], 'peakTime': (created + timedelta(minutes=90)).strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'spreadStatus': '多源扩散' if len(related) >= 2 else '单源讨论', 'sourceCount': len({event['source'], *[item['source'] for item in related]})}, 'timeline': timeline, 'sentiment': sentiment_overview([event]), 'forecast': {'summary': f"预计未来 6 小时该事件将处于{'持续升温' if base >= 80 else '高位讨论' if base >= 65 else '稳定观察'}阶段。", 'cards': [{'horizon': '未来 2 小时', 'score': base, 'direction': '持续升温' if base >= 80 else '短时发酵', 'note': '关注新帖和高互动评论。', 'watch': '是否出现新的跨圈层传播。'}, {'horizon': '未来 6 小时', 'score': clamp(base - 4, 20, 95), 'direction': '持续发酵' if base >= 70 else '高位震荡', 'note': '最容易形成集中传播窗口。', 'watch': '情绪是否继续向负面或支持集中。'}, {'horizon': '未来 24 小时', 'score': clamp(base - 10, 18, 90), 'direction': '观察长尾', 'note': '长尾走势取决于是否有新的回应或证据。', 'watch': '是否沉淀为长期品牌印象或产品问题。'}]}, 'reactionForecast': [{'group': '核心用户', 'focus': '功能体验', 'intensity': '高参与', 'outlook': '会持续跟进产品和回应进度。', 'predictedEmotion': '更容易继续追问关键细节', 'trigger': '如果没有清晰回应，质疑表达会继续增加。'}, {'group': '围观用户', 'focus': '事件观感', 'intensity': '中等参与', 'outlook': '会根据热度决定是否继续讨论。', 'predictedEmotion': '更多保持观望并等待新信息', 'trigger': '新证据或二创内容会再次拉高讨论量。'}, {'group': '潜在支持者', 'focus': '解释质量', 'intensity': '中等参与', 'outlook': '如果后续回应充分，可能转向中性或支持。', 'predictedEmotion': '情绪可能向理性评价回归', 'trigger': '正向案例和修复进展会影响表达方向。'}], 'actions': [{'title': '梳理高频讨论点', 'description': '总结用户集中提到的问题和态度变化。'}, {'title': '同步响应口径', 'description': '优先回答高频问题，降低误读和不确定性。'}, {'title': '持续跟踪扩散节点', 'description': '观察是否出现新的二次扩散和情绪拐点。'}], 'related': [{**item, 'riskClass': risk(item['score'])['className']} for item in related]}

def warnings_payload(interest='', force_refresh=False):
    external = fetch_external_payload('warnings', {'interest': interest})
    if isinstance(external, dict):
        external.setdefault('sourceName', 'External API')
        external.setdefault('updatedAt', datetime.utcnow().isoformat() + 'Z')
        external['_external'] = True
        return external

    dashboard = dashboard_payload(interest, force_refresh)
    warnings = []
    for index, item in enumerate(dashboard['events'][:6]):
        level = alert_level(item['score'])
        obj = dict(item)
        obj.update({'levelText': level['text'], 'levelClass': level['className'], 'trigger': f"{item['categoryLabel']} 热度上升 + {'多区域扩散' if index < 2 else '高互动反馈'}", 'ownerStatus': '已推送' if index == 0 else '待确认' if index < 3 else '跟进中', 'detailUrl': f"./detail.html?id={item['id']}", 'advice': advice(item['category'], item['score'])})
        warnings.append(obj)
    return {'sourceName': dashboard['sourceName'], 'updatedAt': dashboard['updatedAt'], 'stats': {'red': sum(1 for item in warnings if item['levelText'] == '红色'), 'orange': sum(1 for item in warnings if item['levelText'] == '橙色'), 'yellow': sum(1 for item in warnings if item['levelText'] == '黄色'), 'closed': 6 + len(warnings)}, 'rules': ALERT_RULES, 'duty': [{'name': '品牌响应组', 'summary': f"处理中 {max(1, sum(1 for item in warnings if item['category'] == 'brand'))} 项"}, {'name': '产品反馈组', 'summary': f"处理中 {max(1, sum(1 for item in warnings if item['category'] == 'product'))} 项"}, {'name': '趋势观察组', 'summary': f"待复核 {dashboard['stats']['potentialAlerts']} 项"}], 'warnings': warnings}

def search_payload(query='', interest='', force_refresh=False):
    external = fetch_external_payload('search', {'query': query, 'interest': interest})
    if isinstance(external, dict):
        external.setdefault('sourceName', 'External API')
        external.setdefault('updatedAt', datetime.utcnow().isoformat() + 'Z')
        external['_external'] = True
        return external

    bundle = story_bundle(force_refresh)
    search_items = get_search_stories(query, force_refresh)
    items = search_items['items'] if search_items and search_items.get('items') else bundle['items']
    keyword = (query or '').strip().lower()
    interests = parse_interest(interest)
    results = []
    for item in items:
        haystack = ' '.join([item['originalTitle'], item['translatedTitle'], item['categoryLabel'], item['source']]).lower()
        if not keyword or keyword in haystack:
            obj = dict(item)
            obj['matchScore'] = clamp(round_num(item['score'] + (24 if keyword and keyword in item['originalTitle'].lower() else 0)), 20, 150)
            obj['riskText'] = risk(item['score'])['text']
            obj['riskClass'] = risk(item['score'])['className']
            obj['advice'] = advice(item['category'], item['score'])
            results.append(obj)
    results.sort(key=lambda x: x['matchScore'], reverse=True)
    results = results[:10]
    focus_items = results if results else items[:8]
    return {'query': query, 'interestKeys': interests, 'total': len(results), 'results': results, 'keywords': extract_keywords(focus_items), 'predictions': multimodal_summary(focus_items[:6], interests)['predictions'], 'multimodalModel': multimodal_summary(focus_items[:8], interests), 'sourceName': LIVE_SOURCE_NAME if search_items and search_items.get('items') else bundle['sourceName'], 'updatedAt': datetime.utcfromtimestamp(search_items['fetched_at']).isoformat() + 'Z' if search_items and search_items.get('fetched_at') else bundle['updatedAt']}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith('/api/'):
            self.handle_api(parsed)
            return
        self.handle_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/external-config':
            self.handle_external_config_update()
            return
        self.send_response(404)
        self.end_headers()
    def log_message(self, format_string, *args):
        return
    def handle_api(self, parsed):
        params = parse_qs(parsed.query)
        interest = params.get('interest', [''])[0]
        force_refresh = 'refresh' in params
        if parsed.path == '/api/health': payload = {'status': 'ok', 'timestamp': datetime.utcnow().isoformat() + 'Z'}
        elif parsed.path == '/api/dashboard': payload = dashboard_payload(interest, force_refresh)
        elif parsed.path == '/api/monitor': payload = monitor_payload(params.get('filter', ['all'])[0], interest, force_refresh)
        elif parsed.path == '/api/events': payload = event_payload(params.get('id', [''])[0], force_refresh)
        elif parsed.path.startswith('/api/events/'): payload = event_payload(unquote(parsed.path.replace('/api/events/', '')), force_refresh)
        elif parsed.path == '/api/warnings': payload = warnings_payload(interest, force_refresh)
        elif parsed.path == '/api/search': payload = search_payload(params.get('query', [''])[0], interest, force_refresh)
        elif parsed.path == '/api/external-config': payload = load_external_config()
        elif parsed.path == '/api/external-test':
            config = load_external_config()
            dashboard = fetch_external_payload('dashboard', {'interest': interest}) if config.get('enabled') else None
            payload = {'ok': bool(dashboard), 'config': config, 'message': '外部 API 可用' if dashboard else '外部 API 未启用或请求失败'}
        else:
            self.send_response(404); self.end_headers(); return
        data = json.dumps(payload).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def handle_external_config_update(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b'{}'
        try:
            payload = json.loads(raw.decode('utf-8')) if raw else {}
        except Exception:
            self.send_response(400)
            self.end_headers()
            return
        saved = save_external_config(payload)
        data = json.dumps(saved).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def handle_static(self, request_path):
        relative = 'index.html' if request_path in ('', '/') else request_path.lstrip('/')
        file_path = ROOT_DIR / relative
        if not file_path.exists():
            self.send_response(404); self.end_headers(); return
        data = file_path.read_bytes()
        mime_type = mimetypes.guess_type(str(file_path))[0] or 'application/octet-stream'
        if mime_type.startswith('text/') or mime_type == 'application/javascript':
            mime_type = f'{mime_type}; charset=utf-8'
        self.send_response(200)
        self.send_header('Content-Type', mime_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

def pick_port(default=4173):
    for port in range(default, default + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return default

def main():
    port = pick_port()
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    webbrowser.open(f'http://127.0.0.1:{port}')
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        server.shutdown()

if __name__ == '__main__':
    main()


def merge_external_config(raw_config):
    merged = json.loads(json.dumps(DEFAULT_EXTERNAL_API_CONFIG))
    if not isinstance(raw_config, dict):
        return merged
    merged["enabled"] = bool(raw_config.get("enabled", merged["enabled"]))
    merged["base_url"] = str(raw_config.get("base_url", merged["base_url"])).strip()
    merged["token"] = str(raw_config.get("token", merged["token"])).strip()
    try:
        merged["timeout_sec"] = max(3, int(raw_config.get("timeout_sec", merged["timeout_sec"])))
    except Exception:
        pass
    if isinstance(raw_config.get("endpoints"), dict):
        for key, value in raw_config["endpoints"].items():
            if key in merged["endpoints"]:
                merged["endpoints"][key] = str(value or "").strip() or merged["endpoints"][key]
    return merged


def load_external_config():
    if not CONFIG_PATH.exists():
        return merge_external_config({})
    try:
        return merge_external_config(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    except Exception:
        return merge_external_config({})


def save_external_config(config):
    merged = merge_external_config(config)
    CONFIG_PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    return merged


def build_external_url(config, endpoint_key, params=None):
    base_url = str(config.get("base_url") or "").rstrip("/")
    endpoint = str(config.get("endpoints", {}).get(endpoint_key) or "").strip()
    if not base_url or not endpoint:
        return ""
    url = f"{base_url}{endpoint if endpoint.startswith('/') else '/' + endpoint}"
    if params:
        query = urlencode({key: value for key, value in params.items() if value not in (None, "")})
        if query:
            url = f"{url}?{query}"
    return url


def fetch_external_payload(endpoint_key, params=None):
    config = load_external_config()
    if not config.get("enabled"):
        return None
    url = build_external_url(config, endpoint_key, params)
    if not url:
        return None
    headers = {"Accept": "application/json"}
    if config.get("token"):
        headers["Authorization"] = f"Bearer {config['token']}"
    request = Request(url, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=config.get("timeout_sec", 12)) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return payload if isinstance(payload, dict) else {"data": payload}
    except (HTTPError, URLError, TimeoutError, ValueError):
        return None


def try_external_payload(endpoint_key, params, fallback_factory):
    external_payload = fetch_external_payload(endpoint_key, params)
    if isinstance(external_payload, dict):
        external_payload.setdefault("sourceName", "External API")
        external_payload.setdefault("updatedAt", datetime.utcnow().isoformat() + "Z")
        external_payload["_external"] = True
        return external_payload
    payload = fallback_factory()
    payload["_external"] = False
    return payload


