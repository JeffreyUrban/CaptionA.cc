import type { LoaderFunctionArgs } from 'react-router'

// TODO: Replace with actual database integration
// This is a placeholder implementation that returns mock data

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('mode') || 'from_csv'

  // Mock annotation data
  // In production, this would:
  // 1. Connect to SQLite database from PyQt6 scripts
  // 2. Query for next annotation based on mode
  // 3. Fetch frame data and construct image URLs
  // 4. Return structured annotation data

  const mockData = {
    show_id: 'example_show',
    episode_id: 'ep01',
    frames: [
      {
        id: 1,
        frame_index: 100,
        ocr_text: '这是一个测试字幕',
        show_id: 'example_show',
        episode_id: 'ep01',
        image_url: '/placeholder-frame.jpg',
      },
      {
        id: 2,
        frame_index: 101,
        ocr_text: '这是一个测试字幕',
        show_id: 'example_show',
        episode_id: 'ep01',
        image_url: '/placeholder-frame.jpg',
      },
      {
        id: 3,
        frame_index: 102,
        ocr_text: '这是另一个字幕',
        show_id: 'example_show',
        episode_id: 'ep01',
        image_url: '/placeholder-frame.jpg',
      },
    ],
    original_start_idx: 0,
    original_end_idx: 2,
    initial_caption_text: '这是一个测试字幕',
    initial_status: 'valid' as const,
  }

  return Response.json(mockData)
}
