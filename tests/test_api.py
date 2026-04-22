"""FastAPI integration tests using TestClient."""
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_health():
    """The app starts and responds to a basic request."""
    res = client.get("/api/job/nonexistent")
    assert res.status_code == 404


def test_suggestions_returns_list():
    mock_results = [{"display_name": "Berlin, Germany", "lat": "52.5", "lon": "13.4"}]
    with patch("backend.main.requests.get") as mock_get:
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: mock_results,
            raise_for_status=lambda: None,
        )
        res = client.get("/api/suggestions?q=Berlin")
    assert res.status_code == 200
    data = res.json()
    assert "suggestions" in data
    assert isinstance(data["suggestions"], list)


def test_analyze_schools_creates_job():
    with patch("backend.main.asyncio.create_task"):
        res = client.post(
            "/api/analyze",
            json={
                "analysis_type": "schools",
                "city_name": "Bilbao, Spain",
                "distance_walk": 1000,
                "distance_bike": 2500,
                "distance_car": 10000,
                "kids_only": False,
            },
        )
    assert res.status_code == 200
    data = res.json()
    assert "job_id" in data
    assert isinstance(data["job_id"], str)


def test_analyze_parks_creates_job():
    with patch("backend.main.asyncio.create_task"):
        res = client.post(
            "/api/analyze",
            json={
                "analysis_type": "parks",
                "city_name": "Bilbao, Spain",
                "distance_walk": 500,
            },
        )
    assert res.status_code == 200
    assert "job_id" in res.json()


def test_analyze_gtfs_creates_job():
    with patch("backend.main.asyncio.create_task"):
        res = client.post(
            "/api/analyze",
            json={
                "analysis_type": "gtfs",
                "city_name": "Bilbao, Spain",
                "feed_ids": ["feed-123"],
                "start_hour": 8,
                "end_hour": 20,
            },
        )
    assert res.status_code == 200
    assert "job_id" in res.json()


def test_analyze_missing_type_returns_422():
    res = client.post(
        "/api/analyze",
        json={"city_name": "Bilbao, Spain"},
    )
    assert res.status_code == 422


def test_analyze_neither_city_nor_address_returns_422():
    res = client.post(
        "/api/analyze",
        json={"analysis_type": "schools", "distance_walk": 1000},
    )
    assert res.status_code == 422


def test_job_status_not_found():
    res = client.get("/api/job/does-not-exist")
    assert res.status_code == 404


def test_job_status_running():
    from backend.main import jobs
    jobs["test-job-123"] = {
        "status": "running",
        "progress": "Processing...",
        "result": None,
        "error": None,
    }
    res = client.get("/api/job/test-job-123")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "running"
    assert data["progress"] == "Processing..."
    jobs.pop("test-job-123")
