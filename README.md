# Tasks App

A modern React-based task management application with Keycloak OAuth authentication, featuring customizable task lists and templates.

## Features

### Authentication
- **Keycloak OAuth Integration**: Secure authentication using OAuth 2.0 with Keycloak
- **Automatic Token Refresh**: Silent background token renewal to maintain seamless user sessions
- **Session Management**: Persistent login state with proper cleanup on logout

### Task Management
- **Custom Task Lists**: Create personalized task lists with custom names, descriptions, icons, and colors
- **Task Templates**: Define reusable task templates with time slots and estimated durations
- **Visual Customization**: Each list can have a custom emoji/icon and color theme
- **Time Management**: Set time slots and duration estimates for better planning

### User Experience
- **Modal-based Interface**: Clean, focused forms for creating lists and tasks
- **Keyboard Shortcuts**: ESC key support for closing modals
- **Loading States**: Visual feedback during API operations
- **Responsive Design**: Works across different screen sizes

## Technical Architecture

### Authentication System
The app uses a robust authentication context (`AuthContext.js`) that provides:

- **OAuth 2.0 Flow**: Complete authorization code flow with Keycloak
- **Token Management**: Automatic refresh token handling with configurable timing
- **API Integration**: Built-in `apiCall` method that handles authentication headers and token refresh
- **Security Features**:
  - CSRF protection with state parameters
  - Automatic logout on token refresh failures
  - Duplicate request prevention
  - Secure token storage in localStorage

### Key Components

#### AuthProvider
- Manages authentication state and token lifecycle
- Provides context for auth-related operations throughout the app
- Handles OAuth callbacks and error scenarios
- Implements automatic token refresh scheduling

#### AddListModal
- Form for creating new task lists
- Customizable icons (emoji or letters) and colors
- Form validation and error handling

#### AddTaskModal
- Interface for adding task templates to lists
- Supports time slots and duration estimates
- Integrated with the list-specific API endpoints

### API Integration
- RESTful API communication
- Automatic authentication header injection
- Error handling with user feedback
- Token refresh retry logic for 401 responses

## Setup and Installation

### Prerequisites
- Node.js (v14 or higher)
- React development environment
- Keycloak server instance
- Backend API server

### Environment Variables
Create a `.env` file with:
```
REACT_APP_API_URL=your_backend_api_url
```

### Installation
```bash
# Install dependencies
npm install

# Start development server
npm start
```

### Keycloak Configuration
1. Configure your Keycloak realm and client
2. Set the redirect URI to match your application URL
3. Ensure your backend API provides the `/auth/config` endpoint with Keycloak configuration

## API Endpoints

The application expects these backend endpoints:

### Authentication
- `GET /auth/config` - Keycloak configuration
- `POST /auth/callback` - OAuth callback handler
- `POST /auth/refresh` - Token refresh
- `POST /auth/login` - Token validation

### Lists and Tasks
- `POST /lists` - Create new task list
- `POST /lists/:id/templates` - Add task template to list

## Security Considerations

- Tokens are stored in localStorage (consider HttpOnly cookies for production)
- CSRF protection through state parameters
- Automatic cleanup of expired sessions
- Rate limiting considerations for token refresh

## Development Notes

### Token Refresh Strategy
- Refreshes 2 minutes before expiry (or halfway through token life if < 4 minutes)
- Prevents multiple simultaneous refresh attempts
- Graceful fallback to re-authentication on refresh failure

### Error Handling
- Network error recovery
- User-friendly error messages
- Proper loading states
- Form validation

## Future Enhancements

- [ ] Task completion tracking
- [ ] Due date management
- [ ] Task priority levels
- [ ] Drag-and-drop reordering
- [ ] Calendar integration
- [ ] Mobile app companion
- [ ] Team collaboration features
- [ ] Data export/import
- [ ] Advanced filtering and search
- [ ] Notification system

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

[Your chosen license]

---

This task management application provides a solid foundation for personal productivity while maintaining enterprise-grade security through Keycloak integration.