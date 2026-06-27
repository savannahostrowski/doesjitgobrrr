class TestHealthCheck:
    async def test_returns_ok(self, client):
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
