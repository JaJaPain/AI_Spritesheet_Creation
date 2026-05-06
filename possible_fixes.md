# Possible Fixes for 422 Error on /save-project

## Error Analysis
A 422 (Unprocessable Entity) error in FastAPI indicates a **request validation failure** (Pydantic model mismatch). The validation error handler at `backend/main.py:55-62` logs detailed error info to `backend.log` - check this first for exact validation failures.

---

## Fix 1: Incorrect Pydantic Type for `project_id` (Most Likely Cause)
**Problem**: `SaveProjectRequest` at `backend/main.py:979-982` defines `project_id: str = None`, but `None` (JSON `null`) is not a valid `str` type. When the frontend sends `project_id: null` (no active project selected), Pydantic throws a validation error.

**Fix**: Update the model to use `Optional[str]` (matching `SliceRequest` pattern at line 984):
```python
# backend/main.py (line 979-982)
from typing import Optional

class SaveProjectRequest(BaseModel):
    prompt: str
    image_url: str
    project_id: Optional[str] = None  # Changed from str = None
```

---

## Fix 2: Missing `image_url` in Request
**Problem**: The frontend sends `image_url: turnaroundUrl`. If no turnaround is generated, `turnaroundUrl` is `undefined`, so `image_url` is omitted from the request. Since `image_url` is a required field in `SaveProjectRequest`, this triggers a 422 error.

**Fix**: Add a guard in the frontend `handleSaveProject` function (`src/App.jsx:291-312`):
```javascript
const handleSaveProject = async () => {
  if (!turnaroundUrl) {
    alert("Generate a turnaround first!");
    return;
  }
  // ... rest of the function
};
```

---

## Fix 3: Full URL vs Relative Path Mismatch
**Problem**: The frontend sets `turnaroundUrl` to a full absolute URL (`http://localhost:8000/output/xxx.png`), but the backend expects a relative path (`/output/xxx.png`). While this doesn't cause 422 (validation passes), it breaks the file copy logic later.

**Fix**: Strip the base URL in the backend's `save_project` function (`backend/main.py:1018-1048`):
```python
# Add URL parsing import at top of main.py
from urllib.parse import urlparse

# In save_project function, process image_url first:
if req.image_url.startswith("http"):
    parsed = urlparse(req.image_url)
    req.image_url = parsed.path  # Extracts /output/xxx.png from full URL

# Then existing logic:
local_path = req.image_url.replace("/output/", "output/").replace("/output_saves/", "Output_Saves/").lstrip("/")
```

---

## Fix 4: Check Backend Logs for Exact Validation Error
The backend already logs 422 error details to `backend.log` and the console via the validation exception handler. Look for entries like:
```
[422 Error Detail] Path: /save-project | Errors: [{'loc': ['body', 'project_id'], 'msg': 'none is not an allowed value', ...}]
```
This will confirm exactly which field is causing the validation failure.

---

## Verification Steps
1. Apply Fix 1 (Pydantic type) first - this is the most likely cause
2. Restart the backend server
3. Test saving a project with no active project ID (should now work)
4. Test saving with a generated turnaround (should copy the file correctly)
5. Check `backend.log` if errors persist for exact validation details
