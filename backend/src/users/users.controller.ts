import { Controller, Get, Patch, Body, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string; role: string };
}

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users/me')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the current user\'s profile' })
  async getProfile(@Req() req: AuthenticatedRequest) {
    const profile = await this.usersService.getProfile(req.user.userId);
    return { success: true, message: 'Profile retrieved', data: profile };
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the current user\'s profile' })
  async updateProfile(@Body() dto: UpdateProfileDto, @Req() req: AuthenticatedRequest) {
    const profile = await this.usersService.updateProfile(req.user.userId, dto);
    return { success: true, message: 'Profile updated', data: profile };
  }

  @Patch('password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the current user\'s password' })
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthenticatedRequest) {
    const result = await this.usersService.changePassword(req.user.userId, dto);
    return { success: true, message: result.message };
  }
}
